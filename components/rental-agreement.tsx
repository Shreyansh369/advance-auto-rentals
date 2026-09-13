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

import { AgreementSheet } from "./agreement-sheet";

import {
  callFirestoreOperation,
  type ContractStatus,
  type ContractWorkflow,
  type RentalAgreementView,
} from "@/lib/services/firestore-client";

import {
  contractMailerConfigured,
  sendContractEmail,
} from "@/lib/services/contract-mailer";

import { CHARGE_ROWS } from "@/lib/agreement";

import {
  firebaseErrorMessage,
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
 * The agreement as plain text, for handing to the operator's
 * own mail client. It is built from the same stored contract
 * the printed sheet uses, so the customer receives the booking
 * as it was saved rather than as it was typed.
 */
function agreementText(
  agreement: RentalAgreementView,
): string {
  const lines = [
    "ADVANCE AUTO RENTAL",
    "Rental agreement",
    "",
    `Renter: ${agreement.renter.fullName}`,
    `Telephone: ${
      agreement.renter.telephone || "Not recorded"
    }`,
    `Licence: ${agreement.renter.licenceNumber} (${agreement.renter.licenceCountry})`,
    "",
    `Vehicle: ${agreement.vehicle.registration} - ${agreement.vehicle.make} ${agreement.vehicle.model}`.trim(),
    `Date out: ${dateTime(agreement.dateOut)}`,
    `Date in: ${dateTime(agreement.dateIn)}`,
    "",
  ];

  for (const row of CHARGE_ROWS) {
    const cents = agreement.charges[row.key];

    if (cents) {
      lines.push(
        `${row.label}: ${formatMoney(cents)}`,
      );
    }
  }

  lines.push(
    `TOTAL: ${formatMoney(
      agreement.chargeTotalCents,
    )}`,
    "",
    `${
      agreement.customerSignatureMethod ===
      "typed"
        ? "Accepted by"
        : "Signed by"
    }: ${
      agreement.customerSignatureName ||
      agreement.renter.fullName
    }`,
    `Checked out by: ${agreement.checkedOutBy}`,
  );

  return lines.join("\n");
}

/*
 * The agreement is rebuilt from the stored booking every time
 * it is opened, so it always reflects the reservation that was
 * actually saved rather than whatever remains on the form.
 */
export function RentalAgreement({
  rentalId,
  onClose,
}: {
  rentalId: string;
  onClose: () => void;
}) {
  const { role } = useFirebaseAuth();

  const [agreement, setAgreement] =
    useState<RentalAgreementView>();

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
        const sheet =
          await callFirestoreOperation<
            { rentalId: string },
            RentalAgreementView
          >("getRentalAgreement", {
            rentalId,
          });

        if (cancelled) {
          return;
        }

        setAgreement(sheet);

        /*
         * The review workflow is keyed by the booking the
         * rental came from, so the agreement has to be read
         * first to know which one that is.
         */
        const review =
          await callFirestoreOperation<
            { reservationId: string },
            ContractWorkflow
          >("getContractWorkflow", {
            reservationId:
              sheet.reservationId,
          });

        if (!cancelled) {
          setWorkflow(review);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            firebaseErrorMessage(cause),
          );
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [rentalId, reloadToken]);

  const status: ContractStatus =
    workflow?.status ?? "not_submitted";

  const isAdmin = role === "admin";

  const mailerConfigured =
    contractMailerConfigured();

  const recipientEmail =
    agreement?.renter.email ?? null;

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
          {
            reservationId: string;
            rentalId: string;
          },
          {
            reservationId: string;
            version: number;
          }
        >(
          "submitContractForReview",
          {
            reservationId:
              agreement?.reservationId ?? "",
            rentalId,
          },
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
        reservationId:
          agreement?.reservationId ?? "",
        decision,
        note,
      });

      setReviewNote("");

      return decision === "approve"
        ? "Contract approved. It can now be emailed to the customer."
        : "Contract rejected and sent back for correction.";
    });
  }

  /*
   * Sending through the mailer endpoint needs that endpoint
   * deployed. Until it is — and as a fallback whenever it
   * cannot be reached — the agreement can still be handed to
   * whatever mail client the operator already has open. It
   * costs no infrastructure and needs no Firebase plan.
   */
  function emailFromMailClient() {
    if (!agreement) {
      return;
    }

    const to =
      agreement.renter.email ?? "";

    const subject = `Rental agreement ${agreement.rentalId} - ${agreement.vehicle.registration}`;

    const href = `mailto:${encodeURIComponent(
      to,
    )}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(
      agreementText(agreement),
    )}`;

    window.location.href = href;

    setError(undefined);

    setNotice(
      to
        ? `Opening your mail app with the agreement addressed to ${to}. Send it from there, then print or save a copy for the file.`
        : "Opening your mail app with the agreement. This customer has no email address on file, so add the recipient yourself.",
    );
  }

  function emailContract() {
    void run(async () => {
      const result =
        await sendContractEmail(
          agreement?.reservationId ?? "",
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
              {agreement
                ? agreement.vehicle
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
              disabled={!agreement}
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

              {status === "approved" &&
                mailerConfigured && (
                  <button
                    className="button button-primary compact"
                    type="button"
                    disabled={
                      busy ||
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

              {status === "approved" && (
                <button
                  className={
                    mailerConfigured
                      ? "button button-secondary compact"
                      : "button button-primary compact"
                  }
                  type="button"
                  disabled={busy}
                  onClick={
                    emailFromMailClient
                  }
                >
                  <Send size={15} />
                  Send from my mail app
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
                Automatic delivery is not
                configured in this deployment,
                so “Send from my mail app”
                opens the agreement in your own
                email client instead. It can
                also be printed or saved as a
                PDF.
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

        {agreement && (
          <AgreementSheet
            agreement={agreement}
          />
        )}

      </section>
    </div>,
    document.body,
  );
}
