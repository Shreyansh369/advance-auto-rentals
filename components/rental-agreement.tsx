"use client";

import {
  CheckCircle2,
  FileDown,
  Mail,
  Printer,
  Send,
  X,
  XCircle,
} from "lucide-react";

import { createPortal } from "react-dom";

import {
  useEffect,
  useRef,
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
  agreementFilename,
  agreementPdf,
} from "@/lib/agreement-pdf";

import {
  GmailSendError,
  sendAgreementByGmail,
} from "@/lib/services/gmail-sender";

import {
  agreementBody,
  agreementSubject,
  mailtoUrl,
} from "@/lib/contract-message";

import { firebaseErrorMessage } from "@/lib/presentation";

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

  const sheetRef =
    useRef<HTMLDivElement>(null);

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
   * Sends the agreement, as a PDF, from the operator's own
   * Gmail account.
   *
   * The PDF is captured from the sheet already rendered
   * below, so what the renter receives is the sheet the
   * office prints — nobody saves a file and attaches it by
   * hand, and the two cannot fall out of step.
   */
  function sendWithGmail() {
    const sheet = sheetRef.current;

    if (!agreement || !sheet) {
      return;
    }

    const to = agreement.renter.email ?? "";

    if (!to) {
      setNotice(undefined);

      setError(
        "This customer has no email address on file. Add one on the customers screen and try again.",
      );

      return;
    }

    setBusy(true);
    setError(undefined);
    setNotice("Preparing the agreement...");

    void (async () => {
      try {
        const pdf = await agreementPdf(
          sheet,
          agreement,
        );

        setNotice(
          `Sending to ${to}. Accept the Google request if you are asked.`,
        );

        const sent =
          await sendAgreementByGmail({
            to,
            subject:
              agreementSubject(agreement),
            body: agreementBody(agreement),

            attachment: {
              filename: pdf.filename,
              base64: pdf.base64,
            },
          });

        /*
         * The receipt is written after the send, never
         * before: a record of a message that never left
         * would be worse than no record at all.
         */
        try {
          await callFirestoreOperation<
            {
              reservationId: string;
              recipientEmail: string;
              recipientNameSnapshot: string;
              contractVersion: number;
              providerMessageId: string;
              sentFrom: string | null;
            },
            { deliveryId: string }
          >("recordContractDelivery", {
            reservationId:
              agreement.reservationId,
            recipientEmail: to,

            recipientNameSnapshot:
              agreement.renter.fullName,

            contractVersion:
              workflow?.approvedVersion ??
              workflow?.version ??
              0,

            providerMessageId: sent.messageId,
            sentFrom: sent.sentFrom,
          });
        } catch {
          /* The renter has the agreement; only the receipt
             failed. Say so rather than implying the send
             did not happen. */
          setNotice(
            `Sent to ${to}, but the delivery could not be recorded against the contract.`,
          );

          setReloadToken(
            (token) => token + 1,
          );

          return;
        }

        setNotice(
          `Agreement sent to ${to} from ${
            sent.sentFrom ?? "your Google account"
          }, with the PDF attached.`,
        );

        setReloadToken((token) => token + 1);
      } catch (cause) {
        setNotice(undefined);

        setError(
          cause instanceof GmailSendError
            ? cause.message
            : firebaseErrorMessage(cause),
        );
      } finally {
        setBusy(false);
      }
    })();
  }

  /*
   * When Gmail is not an option — a staff member signed in
   * without a Google account, say — the same message can go
   * out through whatever mail client is installed, with the
   * PDF saved alongside it to attach.
   */
  function sendFromMailApp() {
    if (!agreement) {
      return;
    }

    window.location.href =
      mailtoUrl(agreement);

    setError(undefined);

    setNotice(
      "Opening your mail app with the agreement. Use “Save PDF” to attach the signed copy.",
    );
  }

  /* The PDF on its own, for filing or for attaching by hand. */
  function saveAgreementPdf() {
    const sheet = sheetRef.current;

    if (!agreement || !sheet) {
      return;
    }

    setBusy(true);
    setError(undefined);
    setNotice("Preparing the agreement...");

    void (async () => {
      try {
        const pdf = await agreementPdf(
          sheet,
          agreement,
        );

        const blob = new Blob(
          [
            Uint8Array.from(
              atob(pdf.base64),
              (character) =>
                character.charCodeAt(0),
            ),
          ],
          { type: "application/pdf" },
        );

        const href =
          URL.createObjectURL(blob);

        const link =
          document.createElement("a");

        link.href = href;

        link.download = agreementFilename(
          agreement,
        );

        link.click();

        URL.revokeObjectURL(href);

        setNotice(
          `Saved as ${link.download}.`,
        );
      } catch (cause) {
        setNotice(undefined);

        setError(
          firebaseErrorMessage(cause),
        );
      } finally {
        setBusy(false);
      }
    })();
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

              {status === "approved" && (
                <>
                  <button
                    className="button button-primary compact"
                    type="button"
                    disabled={
                      busy || !recipientEmail
                    }
                    onClick={sendWithGmail}
                  >
                    <Send size={15} />
                    Send with Gmail
                  </button>

                  <button
                    className="button button-secondary compact"
                    type="button"
                    disabled={busy}
                    onClick={saveAgreementPdf}
                  >
                    <FileDown size={15} />
                    Save PDF
                  </button>

                  <button
                    className="button button-secondary compact"
                    type="button"
                    disabled={busy}
                    onClick={sendFromMailApp}
                  >
                    <Mail size={15} />
                    Send from my mail app
                  </button>
                </>
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
            recipientEmail && (
              <p className="form-help">
                “Send with Gmail” attaches the
                agreement as a PDF and sends it
                to {recipientEmail} from your own
                Google account. The first send
                on a device asks Google for
                permission to send mail as you;
                nothing else is granted.
              </p>
            )}

          {status === "approved" &&
            !recipientEmail && (
              <p className="form-help">
                This customer has no email
                address on file, so the
                agreement cannot be emailed. Add
                one on the customers screen, or
                use “Save PDF” and send it
                yourself.
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

        {/* The PDF is captured from this element, so the
            emailed copy is the sheet on screen rather than a
            second rendering of it. */}
        <div ref={sheetRef}>
          {agreement && (
            <AgreementSheet
              agreement={agreement}
            />
          )}
        </div>

      </section>
    </div>,
    document.body,
  );
}
