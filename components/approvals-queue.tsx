"use client";

import Link from "next/link";

import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import {
  FileText,
  ListChecks,
  ShieldCheck,
} from "lucide-react";

import {
  useEffect,
  useState,
} from "react";

import { AppShell } from "./app-shell";
import { useFirebaseAuth } from "./firebase-provider";
import { RentalAgreement } from "./rental-agreement";

import { getFirebaseClient } from "@/lib/firebase/client";

import {
  firebaseErrorMessage,
  formatDate,
  formatMoney,
} from "@/lib/presentation";

import {
  callFirestoreOperation,
  cancellationRequestFrom,
  describeDailyRateDiscount,
  rentalDiscountFrom,
  returnRequestFrom,
  type CancellationRequest,
  type RentalDiscount,
  type ReturnRequest,
} from "@/lib/services/firestore-client";

/*
 * Every request waiting for an administrator, in one list:
 * cancellations, backdated returns and discounts. Each is
 * decided through the same operation the Bookings tabs use,
 * so a decision here is exactly a decision there.
 */

type Kind =
  | "cancellation"
  | "backdated_return"
  | "discount";

type Filter = "all" | Kind;

type Entry =
  | {
      kind: "cancellation";
      id: string;
      askedAt: string | null;
      request: CancellationRequest;
    }
  | {
      kind: "backdated_return";
      id: string;
      askedAt: string | null;
      request: ReturnRequest;
    }
  | {
      kind: "discount";
      id: string;
      askedAt: string | null;
      request: RentalDiscount;
    };

const FILTERS: Array<{
  id: Filter;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "cancellation", label: "Cancellations" },
  {
    id: "backdated_return",
    label: "Backdated returns",
  },
  { id: "discount", label: "Discounts" },
];

const KIND_LABEL: Record<Kind, string> = {
  cancellation: "Cancellation",
  backdated_return: "Backdated return",
  discount: "Discount",
};

/* As many as a badge would count, and then some. */
const QUEUE_LIMIT = 200;

function moment(value: string | null): string {
  return formatDate(value, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/* What the request asks for, in a line. */
function askedFor(entry: Entry): string {
  switch (entry.kind) {
    case "cancellation":
      return entry.request.pickupAt
        ? `Cancel the booking for ${moment(
            entry.request.pickupAt,
          )} → ${moment(
            entry.request.expectedReturnAt,
          )}`
        : "Cancel the booking";

    case "backdated_return":
      return `Returned ${moment(
        entry.request.requestedReturnAt,
      )} · entered ${moment(
        entry.request.enteredAt,
      )}`;

    case "discount":
      return entry.request.dailyRate
        ? describeDailyRateDiscount(entry.request)
        : `${formatMoney(
            entry.request.amountCents,
          )} off the balance (offered at the end of the hire)`;
  }
}

/* A live list of one collection's waiting requests. */
function usePending<T>(
  collectionName: string,
  enabled: boolean,
  from: (
    id: string,
    data: Record<string, unknown>,
  ) => T,
  onError: (message: string) => void,
): T[] | undefined {
  const [items, setItems] = useState<T[]>();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let unsubscribe:
      | (() => void)
      | undefined;

    try {
      unsubscribe = onSnapshot(
        query(
          collection(
            getFirebaseClient().db,
            collectionName,
          ),
          where("status", "==", "pending"),
          limit(QUEUE_LIMIT),
        ),

        (snapshot) =>
          setItems(
            snapshot.docs.map((entry) =>
              from(entry.id, entry.data()),
            ),
          ),

        (cause) => {
          setItems([]);
          onError(firebaseErrorMessage(cause));
        },
      );
    } catch (cause) {
      onError(firebaseErrorMessage(cause));
    }

    return () => unsubscribe?.();
  }, [collectionName, enabled, from, onError]);

  return items;
}

export function ApprovalsQueue() {
  const { role } = useFirebaseAuth();

  const isAdmin = role === "admin";

  const [filter, setFilter] =
    useState<Filter>("all");

  const [notes, setNotes] = useState<
    Record<string, string>
  >({});

  const [busyId, setBusyId] =
    useState<string | null>(null);

  const [error, setError] = useState<string>();

  const [notice, setNotice] =
    useState<string>();

  /* Set when an approved return leaves a balance to take. */
  const [paymentRentalId, setPaymentRentalId] =
    useState<string | null>(null);

  const [fileRentalId, setFileRentalId] =
    useState<string | null>(null);

  const cancellations = usePending(
    "cancellationRequests",
    isAdmin,
    cancellationRequestFrom,
    setError,
  );

  const returns = usePending(
    "returnRequests",
    isAdmin,
    returnRequestFrom,
    setError,
  );

  const discounts = usePending(
    "rentalDiscounts",
    isAdmin,
    rentalDiscountFrom,
    setError,
  );

  /*
   * A discount asked for on a booking names no rental, but the
   * booking may have been checked out since; its rental is
   * found through the booking so its file can be opened.
   */
  const [bookingRentals, setBookingRentals] =
    useState<Record<string, string | null>>({});

  useEffect(() => {
    const unknown = (discounts ?? [])
      .map(
        (discount) =>
          discount.dailyRate?.reservationId,
      )
      .filter(
        (id): id is string =>
          Boolean(id) &&
          !((id as string) in bookingRentals),
      );

    if (unknown.length === 0) {
      return;
    }

    let cancelled = false;

    void Promise.all(
      unknown.map(async (reservationId) => {
        const snapshot = await getDoc(
          doc(
            getFirebaseClient().db,
            "reservations",
            reservationId,
          ),
        ).catch(() => null);

        const rentalId = snapshot?.get("rentalId");

        return [
          reservationId,
          typeof rentalId === "string" && rentalId
            ? rentalId
            : null,
        ] as const;
      }),
    ).then((found) => {
      if (!cancelled) {
        setBookingRentals((current) => ({
          ...current,
          ...Object.fromEntries(found),
        }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [discounts, bookingRentals]);

  if (!isAdmin) {
    return (
      <AppShell
        title="Approvals"
        eyebrow="Restricted"
      >
        <section className="empty-state prominent">
          <div className="empty-illustration">
            <ShieldCheck />
          </div>

          <div>
            <h2>
              Administrator access required
            </h2>

            <p>
              Cancellations, backdated returns and
              discounts are approved by an
              administrator.
            </p>
          </div>
        </section>
      </AppShell>
    );
  }

  const loading =
    cancellations === undefined ||
    returns === undefined ||
    discounts === undefined;

  const entries: Entry[] = [
    ...(cancellations ?? []).map(
      (request): Entry => ({
        kind: "cancellation",
        id: request.id,
        askedAt: request.requestedAt,
        request,
      }),
    ),
    ...(returns ?? []).map(
      (request): Entry => ({
        kind: "backdated_return",
        id: request.id,
        askedAt: request.enteredAt,
        request,
      }),
    ),
    ...(discounts ?? []).map(
      (request): Entry => ({
        kind: "discount",
        id: request.id,
        askedAt: request.requestedAt,
        request,
      }),
    ),
  ].sort((a, b) =>
    String(a.askedAt).localeCompare(
      String(b.askedAt),
    ),
  );

  const count = (id: Filter) =>
    id === "all"
      ? entries.length
      : entries.filter((entry) => entry.kind === id)
          .length;

  const shown = entries.filter(
    (entry) =>
      filter === "all" || entry.kind === filter,
  );

  function rentalOf(entry: Entry): string | null {
    switch (entry.kind) {
      case "cancellation":
        return null;

      case "backdated_return":
        return entry.request.rentalId || null;

      case "discount":
        return (
          entry.request.rentalId ||
          (entry.request.dailyRate
            ? (bookingRentals[
                entry.request.dailyRate.reservationId
              ] ?? null)
            : null)
        );
    }
  }

  async function decide(
    entry: Entry,
    decision: "approve" | "reject",
  ) {
    setError(undefined);
    setNotice(undefined);
    setPaymentRentalId(null);
    setBusyId(entry.id);

    const note =
      notes[entry.id]?.trim() || null;

    try {
      let message: string;

      /*
       * The same operations, and the same words, as the
       * approval blocks on the Bookings tabs.
       */
      if (entry.kind === "cancellation") {
        const result =
          await callFirestoreOperation<
            {
              requestId: string;
              decision: "approve" | "reject";
              note: string | null;
            },
            {
              status: string;
              vehicleReleased: boolean;
            }
          >("reviewCancellationRequest", {
            requestId: entry.id,
            decision,
            note,
          });

        message =
          result.status === "approved"
            ? `Cancellation approved · ${entry.request.vehicleRegistration} booking cancelled${
                result.vehicleReleased
                  ? " and the vehicle is available again"
                  : ""
              }.`
            : `Cancellation of ${entry.request.vehicleRegistration} rejected · the booking stays active.`;
      } else if (
        entry.kind === "backdated_return"
      ) {
        const result =
          await callFirestoreOperation<
            {
              requestId: string;
              decision: "approve" | "reject";
              note: string | null;
            },
            {
              status: string;
              rentalId: string;
              outstandingCents: number | null;
            }
          >("reviewReturnRequest", {
            requestId: entry.id,
            decision,
            note,
          });

        if (result.status !== "approved") {
          message = `Backdated return for ${entry.request.vehicleRegistration} rejected · the rental stays open.`;
        } else if (
          (result.outstandingCents ?? 0) > 0
        ) {
          setPaymentRentalId(result.rentalId);

          message = `Backdated return approved · ${formatMoney(
            result.outstandingCents ?? 0,
          )} outstanding.`;
        } else {
          message =
            "Backdated return approved · nothing left to pay.";
        }
      } else {
        const result =
          await callFirestoreOperation<
            {
              discountId: string;
              decision: "approve" | "reject";
              note: string | null;
            },
            {
              status: string;
              outstandingCents: number | null;
            }
          >("reviewRentalDiscount", {
            discountId: entry.id,
            decision,
            note,
          });

        message =
          result.status === "approved"
            ? result.outstandingCents === null
              ? `Discount approved for ${entry.request.vehicleRegistration} · the booking is now priced at the discounted daily rate.`
              : `Discount approved for ${entry.request.vehicleRegistration} · ${formatMoney(
                  result.outstandingCents,
                )} now outstanding.`
            : `Discount for ${entry.request.vehicleRegistration} rejected.`;
      }

      setNotes((current) => {
        const next = { ...current };

        delete next[entry.id];

        return next;
      });

      setNotice(message);
    } catch (cause) {
      setError(firebaseErrorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell
      title="Approvals"
      eyebrow="Waiting for an administrator"
    >
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
          <span>{notice}</span>

          {paymentRentalId && (
            <Link
              className="button button-secondary compact"
              href={`/rentals?tab=payment&rental=${encodeURIComponent(
                paymentRentalId,
              )}`}
            >
              Take the payment on Bookings
            </Link>
          )}
        </div>
      )}

      {fileRentalId && (
        <RentalAgreement
          rentalId={fileRentalId}
          onClose={() => setFileRentalId(null)}
        />
      )}

      <section className="surface booking-list">
        <div
          className="filter-scroll"
          aria-label="Request type filter"
        >
          {FILTERS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={
                filter === item.id
                  ? "filter-chip active"
                  : "filter-chip"
              }
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <span>{count(item.id)}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <p className="form-help">
            Loading requests…
          </p>
        ) : shown.length === 0 ? (
          <div className="empty-state">
            <div className="empty-illustration">
              <ListChecks />
            </div>

            <p>Nothing is waiting for approval.</p>
          </div>
        ) : (
          <ul>
            {shown.map((entry) => {
              const rentalId = rentalOf(entry);

              const note =
                notes[entry.id] ?? "";

              const busy = busyId !== null;

              return (
                <li key={`${entry.kind}-${entry.id}`}>
                  <span
                    className={
                      entry.kind === "cancellation"
                        ? "status-pill overdue"
                        : entry.kind ===
                            "backdated_return"
                          ? "status-pill reserved"
                          : "status-pill cleaning"
                    }
                  >
                    {KIND_LABEL[entry.kind]}
                  </span>

                  <span className="booking-list-detail">
                    <strong>
                      {entry.request
                        .vehicleRegistration ||
                        "Vehicle not recorded"}
                      {" · "}
                      {entry.request.customerName ||
                        "Customer not recorded"}
                    </strong>

                    <small>{askedFor(entry)}</small>

                    <small>
                      “{entry.request.reason}”
                    </small>

                    <small>
                      Asked by{" "}
                      {entry.request
                        .requestedByName || "staff"}
                      {" · "}
                      {moment(entry.askedAt)}
                    </small>

                    {rentalId && (
                      <button
                        className="text-button"
                        type="button"
                        style={{
                          alignSelf: "flex-start",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                        onClick={() =>
                          setFileRentalId(rentalId)
                        }
                      >
                        <FileText size={14} />
                        Open rental file
                      </button>
                    )}
                  </span>

                  <span className="booking-list-confirm">
                    <input
                      aria-label={`Decision note for ${entry.request.vehicleRegistration}`}
                      placeholder="Note (required to reject)"
                      maxLength={1000}
                      value={note}
                      disabled={busy}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [entry.id]:
                            event.target.value,
                        }))
                      }
                    />

                    <button
                      className="button button-primary compact"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void decide(entry, "approve")
                      }
                    >
                      {busyId === entry.id
                        ? "Saving…"
                        : "Approve"}
                    </button>

                    <button
                      className="button button-secondary compact"
                      type="button"
                      disabled={busy || !note.trim()}
                      onClick={() =>
                        void decide(entry, "reject")
                      }
                    >
                      Reject
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
