"use client";

import { Printer, X } from "lucide-react";

import { createPortal } from "react-dom";

import {
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import {
  callFirestoreOperation,
  type ReservationContract,
} from "@/lib/services/firestore-client";

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
  const [contract, setContract] =
    useState<ReservationContract>();

  const [error, setError] =
    useState<string>();

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
        const result =
          await callFirestoreOperation<
            { reservationId: string },
            ReservationContract
          >(
            "getReservationContract",
            { reservationId },
          );

        if (!cancelled) {
          setContract(result);
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
  }, [reservationId]);

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
