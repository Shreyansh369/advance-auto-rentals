"use client";

import { useEffect, useState } from "react";

import {
  callFirestoreOperation,
  type RentalHistoryEntry,
} from "@/lib/services/firestore-client";

import {
  firebaseErrorMessage,
  formatMoney,
} from "@/lib/presentation";

/*
 * One history list, shown on the dashboard as a recent-activity
 * panel and on the customers screen as a full table. Both read
 * the same records so the two screens can never disagree about
 * what a rental cost.
 */
export type RentalHistoryProps = {
  /** Limits the history to a single customer. */
  customerId?: string | null;

  limit?: number;

  /** Free-text filter applied by the customers screen. */
  search?: string;

  /** The dashboard shows a trimmed set of columns. */
  compact?: boolean;

  reloadToken?: number;
};

function day(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function statusLabel(status: string): string {
  switch (status) {
    case "returned":
      return "Returned";

    case "overdue":
      return "Overdue";

    case "active":
      return "On rent";

    default:
      return status
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) =>
          letter.toUpperCase(),
        );
  }
}

function statusTone(status: string): string {
  switch (status) {
    case "returned":
      return "available";

    case "overdue":
      return "overdue";

    case "active":
      return "rented";

    default:
      return "";
  }
}

export function RentalHistory({
  customerId = null,
  limit = 50,
  search = "",
  compact = false,
  reloadToken = 0,
}: RentalHistoryProps) {
  const [entries, setEntries] = useState<
    RentalHistoryEntry[]
  >([]);

  const [error, setError] =
    useState<string>();

  const [loading, setLoading] =
    useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result =
          await callFirestoreOperation<
            {
              customerId: string | null;
              limit: number;
            },
            RentalHistoryEntry[]
          >("listRentalHistory", {
            customerId,
            limit,
          });

        if (cancelled) {
          return;
        }

        setEntries(result);
        setError(undefined);
      } catch (cause) {
        if (!cancelled) {
          setEntries([]);

          setError(
            firebaseErrorMessage(cause),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    customerId,
    limit,
    reloadToken,
  ]);

  const needle = search
    .trim()
    .toLowerCase();

  const visible = needle
    ? entries.filter((entry) =>
        [
          entry.customerName,
          entry.vehicleRegistration,
          entry.status,
        ].some((value) =>
          String(value)
            .toLowerCase()
            .includes(needle),
        ),
      )
    : entries;

  if (loading) {
    return (
      <div
        className="inline-empty"
        role="status"
        aria-live="polite"
      >
        Loading rental history...
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="alert alert-error"
        role="alert"
      >
        {error}
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="inline-empty">
        {entries.length === 0
          ? "No rentals have been recorded yet."
          : "No rentals match this search."}
      </div>
    );
  }

  if (compact) {
    return (
      <div className="list-table">
        {visible.map((entry) => (
          <div
            className="pickup-row"
            key={entry.rentalId}
          >
            <div className="pickup-time">
              <strong>
                {day(
                  entry.actualReturnAt ??
                    entry.pickupAt,
                )}
              </strong>

              <span>
                {entry.actualReturnAt
                  ? "returned"
                  : "picked up"}
              </span>
            </div>

            <div className="pickup-customer">
              <strong>
                {entry.customerName}
              </strong>

              <span>
                {entry.vehicleRegistration}
                {" · "}
                {formatMoney(
                  entry.totalCents,
                )}
                {entry.outstandingCents > 0
                  ? ` · ${formatMoney(
                      entry.outstandingCents,
                    )} outstanding`
                  : ""}
              </span>
            </div>

            <span
              className={`status-pill ${statusTone(
                entry.status,
              )}`}
            >
              {statusLabel(entry.status)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="table-wrap customer-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Vehicle</th>
            <th>Customer</th>
            <th>Picked up</th>
            <th>Returned</th>
            <th>Rent</th>
            <th>Outstanding</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>
          {visible.map((entry) => (
            <tr key={entry.rentalId}>
              <td>
                <strong>
                  {entry.vehicleRegistration}
                </strong>
              </td>

              <td>
                <strong>
                  {entry.customerName}
                </strong>
              </td>

              <td>{day(entry.pickupAt)}</td>

              <td>
                {day(entry.actualReturnAt)}
              </td>

              <td>
                <strong>
                  {formatMoney(
                    entry.totalCents,
                  )}
                </strong>

                {entry.adjustmentCents > 0 && (
                  <span>
                    {formatMoney(
                      entry.baseRentalCents,
                    )}
                    {" base · "}
                    {formatMoney(
                      entry.adjustmentCents,
                    )}
                    {" adjustments"}
                  </span>
                )}
              </td>

              <td>
                {entry.outstandingCents > 0 ? (
                  <strong>
                    {formatMoney(
                      entry.outstandingCents,
                    )}
                  </strong>
                ) : (
                  "Settled"
                )}
              </td>

              <td>
                <span
                  className={`status-pill ${statusTone(
                    entry.status,
                  )}`}
                >
                  {statusLabel(entry.status)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
