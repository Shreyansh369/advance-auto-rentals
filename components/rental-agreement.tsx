"use client";

import {
  CheckCircle2,
  Mail,
  Printer,
  Send,
  X,
  XCircle,
} from "lucide-react";

import { createPortal } from "react-dom";

import {
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import { useFirebaseAuth } from "./firebase-provider";

import {
  callFirestoreOperation,
  type ContractStatus,
  type ContractWorkflow,
  type ReservationContract,
} from "@/lib/services/firestore-client";

import {
  contractMailerConfigured,
  sendContractEmail,
} from "@/lib/services/contract-mailer";

import {
  firebaseErrorMessage,
  formatDate,
  formatMoney,
} from "@/lib/presentation";

/** The hydration flag never changes, so there is nothing to subscribe to. */
function subscribeToNothing(): () => void {
  return () => {};
}

function dateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return "Not recorded";
  }

  return date.toLocaleString(
    "en-US",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  );
}

function moment(
  value: string | null,
): string {
  return value
    ? dateTime(value)
    : "Not recorded";
}

function statusLabel(
  status: ContractStatus,
): string {
  switch (status) {
    case "in_review":
      return "Waiting for review";

    case "approved":
      return "Approved";

    case "rejected":
      return "Rejected";

    default:
      return "Not submitted";
  }
}

/*
 * The pill re-uses the fleet status palette rather than
 * introducing a second set of colours for the same idea.
 */
function statusTone(
  status: ContractStatus,
): string {
  switch (status) {
    case "in_review":
      return "cleaning";

    case "approved":
      return "available";

    case "rejected":
      return "overdue";

    default:
      return "";
  }
}

/*
 * The agreement is rebuilt from the stored booking every time
 * it is opened, so it always reflects the reservation that was
 * actually saved rather than whatever remains on the form.
 */
export function RentalAgreement({
  reservationId,
  onClose,
}: {
  reservationId: string;
  onClose: () => void;
}) {
  const { role } = useFirebaseAuth();

  const [contract, setContract] =
    useState<ReservationContract>();

  const [workflow, setWorkflow] =
    useState<ContractWorkflow>();

  const [error, setError] =
    useState<string>();

  const [notice, setNotice] =
    useState<string>();

  const [busy, setBusy] =
    useState(false);

  const [reviewNote, setReviewNote] =
    useState("");

  /*
   * Every decision rewrites the workflow record, so the panel
   * is re-read from Firestore afterwards instead of being
   * patched locally and drifting from what was stored.
   */
  const [reloadToken, setReloadToken] =
    useState(0);

  /*
   * The dialog is mounted on document.body rather than inside
   * the application shell. Printing hides the shell, and a
   * descendant of a hidden element cannot be printed, so the
   * agreement has to sit outside it.
   *
   * The page is prerendered as static HTML, where there is no
   * document to portal into, so the portal waits for hydration.
   */
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [
          agreement,
          review,
        ] = await Promise.all([
          callFirestoreOperation<
            { reservationId: string },
            ReservationContract
          >(
            "getReservationContract",
            { reservationId },
          ),

          callFirestoreOperation<
            { reservationId: string },
            ContractWorkflow
          >(
            "getContractWorkflow",
            { reservationId },
          ),
        ]);

        if (!cancelled) {
          setContract(agreement);
          setWorkflow(review);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            firebaseErrorMessage(
              cause,
            ),
          );
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    reservationId,
    reloadToken,
  ]);

  const status: ContractStatus =
    workflow?.status ?? "not_submitted";

  const isAdmin = role === "admin";

  const mailerConfigured =
    contractMailerConfigured();

  const recipientEmail =
    contract?.customer.email ?? null;

  async function run(
    action: () => Promise<string>,
  ) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);

    try {
      const message = await action();

      setNotice(message);

      setReloadToken(
        (token) => token + 1,
      );
    } catch (cause) {
      setError(
        firebaseErrorMessage(cause),
      );
    } finally {
      setBusy(false);
    }
  }

  function submitForReview() {
    void run(async () => {
      const result =
        await callFirestoreOperation<
          { reservationId: string },
          {
            reservationId: string;
            version: number;
          }
        >(
          "submitContractForReview",
          { reservationId },
        );

      return `Sent for review as version ${result.version}.`;
    });
  }

  function decide(
    decision: "approve" | "reject",
  ) {
    const note =
      reviewNote.trim() || null;

    if (
      decision === "reject" &&
      !note
    ) {
      setNotice(undefined);

      setError(
        "Explain why the contract is being rejected.",
      );

      return;
    }

    void run(async () => {
      await callFirestoreOperation<
        {
          reservationId: string;
          decision:
            | "approve"
            | "reject";
          note: string | null;
        },
        unknown
      >("reviewContract", {
        reservationId,
        decision,
        note,
      });

      setReviewNote("");

      return decision === "approve"
        ? "Contract approved. It can now be emailed to the customer."
        : "Contract rejected and sent back for correction.";
    });
  }

  function emailContract() {
    void run(async () => {
      const result =
        await sendContractEmail(
          reservationId,
        );

      return `Agreement emailed to ${result.recipientEmail}.`;
    });
  }

  if (!hydrated) {
    return null;
  }

  return createPortal(
    <div
      className="agreement-backdrop"
      role="presentation"
    >
      <section
        className="agreement-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Rental agreement"
      >
        <header className="agreement-modal-header">
          <div>
            <p className="page-kicker">
              Rental agreement
            </p>

            <h2>
              {contract
                ? contract.vehicle
                    .registration
                : "Loading agreement"}
            </h2>
          </div>

          <div className="agreement-modal-actions">
            <button
              className="button button-secondary compact"
              type="button"
              onClick={() =>
                window.print()
              }
              disabled={!contract}
            >
              <Printer size={16} />
              Print
            </button>

            <button
              className="icon-button"
              type="button"
              onClick={onClose}
              aria-label="Close rental agreement"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {error && (
          <div
            className="alert alert-error"
            role="alert"
          >
            {error}
          </div>
        )}

        {notice && (
          <div
            className="alert alert-success"
            role="status"
          >
            {notice}
          </div>
        )}

        <section className="agreement-review">
          <div className="agreement-review-head">
            <div>
              <p className="section-kicker">
                Contract review
              </p>

              <p className="agreement-review-state">
                <span
                  className={`status-pill ${statusTone(
                    status,
                  )}`}
                >
                  {statusLabel(status)}
                </span>

                {workflow &&
                  workflow.version >
                    0 && (
                    <span className="quiet">
                      Version{" "}
                      {workflow.version}
                    </span>
                  )}
              </p>
            </div>

            <div className="agreement-review-actions">
              {(status ===
                "not_submitted" ||
                status ===
                  "rejected") && (
                <button
                  className="button button-primary compact"
                  type="button"
                  disabled={
                    busy || !workflow
                  }
                  onClick={
                    submitForReview
                  }
                >
                  <Send size={15} />
                  Submit for review
                </button>
              )}

              {status ===
                "in_review" &&
                isAdmin && (
                  <>
                    <button
                      className="button button-primary compact"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        decide(
                          "approve",
                        )
                      }
                    >
                      <CheckCircle2
                        size={15}
                      />
                      Approve
                    </button>

                    <button
                      className="button button-secondary compact"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        decide("reject")
                      }
                    >
                      <XCircle
                        size={15}
                      />
                      Reject
                    </button>
                  </>
                )}

              {status ===
                "approved" && (
                <button
                  className="button button-primary compact"
                  type="button"
                  disabled={
                    busy ||
                    !mailerConfigured ||
                    !recipientEmail
                  }
                  onClick={
                    emailContract
                  }
                >
                  <Mail size={15} />
                  Email to customer
                </button>
              )}
            </div>
          </div>

          {status === "in_review" &&
            isAdmin && (
              <div className="field">
                <label htmlFor="contract-review-note">
                  Review note
                </label>

                <textarea
                  id="contract-review-note"
                  value={reviewNote}
                  maxLength={1000}
                  onChange={(event) =>
                    setReviewNote(
                      event.target
                        .value,
                    )
                  }
                  placeholder="Required when rejecting, optional when approving."
                />
              </div>
            )}

          {status === "in_review" &&
            !isAdmin && (
              <p className="form-help">
                An administrator has to
                approve this agreement
                before it can be emailed.
              </p>
            )}

          {status === "approved" &&
            !mailerConfigured && (
              <p className="form-help">
                Email delivery is not
                configured in this
                deployment. The agreement
                can still be printed or
                saved as a PDF.
              </p>
            )}

          {status === "approved" &&
            mailerConfigured &&
            !recipientEmail && (
              <p className="form-help">
                This customer has no email
                address on file, so the
                agreement cannot be emailed.
              </p>
            )}

          {workflow && (
            <dl className="agreement-review-meta">
              {workflow.submittedByNameSnapshot && (
                <div>
                  <dt>
                    Submitted by
                  </dt>

                  <dd>
                    {
                      workflow.submittedByNameSnapshot
                    }
                    {" · "}
                    {moment(
                      workflow.submittedAt,
                    )}
                  </dd>
                </div>
              )}

              {workflow.reviewedByNameSnapshot && (
                <div>
                  <dt>Reviewed by</dt>

                  <dd>
                    {
                      workflow.reviewedByNameSnapshot
                    }
                    {" · "}
                    {moment(
                      workflow.reviewedAt,
                    )}
                  </dd>
                </div>
              )}

              {workflow.reviewNote && (
                <div>
                  <dt>Review note</dt>

                  <dd>
                    {workflow.reviewNote}
                  </dd>
                </div>
              )}
            </dl>
          )}

          {workflow &&
            workflow.deliveries.length >
              0 && (
              <div className="agreement-deliveries">
                <h3>Email history</h3>

                <ul>
                  {workflow.deliveries.map(
                    (delivery) => (
                      <li
                        key={
                          delivery.id
                        }
                      >
                        <span
                          className={
                            delivery.status ===
                            "failed"
                              ? "status-pill overdue"
                              : "status-pill available"
                          }
                        >
                          {delivery.status ===
                          "failed"
                            ? "Failed"
                            : "Sent"}
                        </span>

                        <span>
                          {
                            delivery.recipientEmail
                          }
                          {" · version "}
                          {
                            delivery.contractVersion
                          }
                          {" · "}
                          {moment(
                            delivery.createdAt,
                          )}
                        </span>

                        {delivery.failureReason && (
                          <small>
                            {
                              delivery.failureReason
                            }
                          </small>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            )}
        </section>

        {contract && (
          <article className="agreement-sheet">
            <div className="agreement-brand">
              <img
                src="/brand/advance-auto-rentals-logo.png"
                alt="Advance Auto Rental &amp; Repairs"
              />

              <div>
                <strong>
                  Rental agreement
                </strong>

                <span>
                  Booking reference{" "}
                  {contract.reservationId}
                </span>
              </div>
            </div>

            <div className="agreement-columns">
              <section>
                <h3>Customer</h3>

                <dl>
                  <div>
                    <dt>Name</dt>
                    <dd>
                      {
                        contract.customer
                          .fullName
                      }
                    </dd>
                  </div>

                  <div>
                    <dt>Telephone</dt>
                    <dd>
                      {contract.customer
                        .telephone ||
                        "Not recorded"}
                    </dd>
                  </div>

                  <div>
                    <dt>Email</dt>
                    <dd>
                      {contract.customer
                        .email ||
                        "Not recorded"}
                    </dd>
                  </div>

                  <div>
                    <dt>Address</dt>
                    <dd>
                      {contract.customer
                        .address ||
                        "Not recorded"}
                    </dd>
                  </div>

                  <div>
                    <dt>Licence</dt>
                    <dd>
                      {
                        contract.customer
                          .licenceNumber
                      }{" "}
                      (
                      {
                        contract.customer
                          .licenceCountry
                      }
                      )
                    </dd>
                  </div>

                  <div>
                    <dt>Licence expiry</dt>
                    <dd>
                      {formatDate(
                        contract.customer
                          .licenceExpiresAt,
                      )}
                    </dd>
                  </div>
                </dl>
              </section>

              <section>
                <h3>Vehicle</h3>

                <dl>
                  <div>
                    <dt>Registration</dt>
                    <dd>
                      {
                        contract.vehicle
                          .registration
                      }
                    </dd>
                  </div>

                  <div>
                    <dt>Make and model</dt>
                    <dd>
                      {
                        contract.vehicle
                          .make
                      }{" "}
                      {
                        contract.vehicle
                          .model
                      }
                    </dd>
                  </div>

                  <div>
                    <dt>Year</dt>
                    <dd>
                      {contract.vehicle
                        .year ??
                        "Not recorded"}
                    </dd>
                  </div>

                  <div>
                    <dt>Colour</dt>
                    <dd>
                      {contract.vehicle
                        .color ||
                        "Not recorded"}
                    </dd>
                  </div>

                  <div>
                    <dt>VIN</dt>
                    <dd>
                      {contract.vehicle
                        .vin ||
                        "Not recorded"}
                    </dd>
                  </div>
                </dl>
              </section>

              <section>
                <h3>Rental period</h3>

                <dl>
                  <div>
                    <dt>Pickup</dt>
                    <dd>
                      {dateTime(
                        contract.pickupAt,
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt>Expected return</dt>
                    <dd>
                      {dateTime(
                        contract.expectedReturnAt,
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt>Pickup location</dt>
                    <dd>
                      {contract.pickupLocation ||
                        "Not recorded"}
                    </dd>
                  </div>

                  <div>
                    <dt>Drop-off location</dt>
                    <dd>
                      {contract.dropoffLocation ||
                        "Not recorded"}
                    </dd>
                  </div>
                </dl>
              </section>

              <section>
                <h3>Charges</h3>

                <dl>
                  <div>
                    <dt>Rental days</dt>
                    <dd>
                      {contract.chargedDays}
                    </dd>
                  </div>

                  <div>
                    <dt>Daily rate</dt>
                    <dd>
                      {contract.rateSnapshot
                        .dailyCents == null
                        ? "Not offered"
                        : formatMoney(
                            contract
                              .rateSnapshot
                              .dailyCents,
                          )}
                    </dd>
                  </div>

                  <div>
                    <dt>Weekly rate</dt>
                    <dd>
                      {contract.rateSnapshot
                        .weeklyCents == null
                        ? "Not offered"
                        : formatMoney(
                            contract
                              .rateSnapshot
                              .weeklyCents,
                          )}
                    </dd>
                  </div>

                  <div>
                    <dt>Monthly rate</dt>
                    <dd>
                      {contract.rateSnapshot
                        .monthlyCents == null
                        ? "Not offered"
                        : formatMoney(
                            contract
                              .rateSnapshot
                              .monthlyCents,
                          )}
                    </dd>
                  </div>

                  <div className="agreement-total">
                    <dt>Rental total</dt>
                    <dd>
                      {formatMoney(
                        contract.baseRentalCents,
                      )}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            {contract.notes && (
              <section className="agreement-notes">
                <h3>Booking note</h3>

                <p>{contract.notes}</p>
              </section>
            )}

            <section className="agreement-signature">
              <div>
                <h3>
                  Customer signature
                </h3>

                {contract.customerSignatureDataUrl ? (
                  <img
                    src={
                      contract.customerSignatureDataUrl
                    }
                    alt="Customer signature"
                  />
                ) : (
                  <p className="quiet">
                    No signature was captured
                    for this booking.
                  </p>
                )}

                <small>
                  {
                    contract.customer
                      .fullName
                  }
                </small>
              </div>

              <div>
                <h3>Prepared by</h3>

                <p>
                  {contract.preparedBy}
                </p>

                <small>
                  {formatDate(
                    contract.createdAt,
                    {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    },
                  )}
                </small>
              </div>
            </section>
          </article>
        )}
      </section>
    </div>,
    document.body,
  );
}
