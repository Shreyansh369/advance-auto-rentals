"use client";

import {
  CalendarRange,
  RefreshCw,
  Search,
} from "lucide-react";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  firebaseErrorMessage,
} from "@/lib/presentation";

import {
  callFirestoreOperation,
  type RentalRecord,
} from "@/lib/services/firestore-client";

import { RentalAgreement } from "./rental-agreement";

/*
 * Every rental the office has run, with the employee who
 * handled it beside the customer and the vehicle.
 *
 * It carries no money on purpose. What an administrator needs
 * here is who rented which vehicle to whom and when it came
 * back; revenue lives on the Finance screen, which only an
 * administrator can open. Keeping the two apart is what lets
 * this screen be shown to operations in full.
 */

type StatusFilter =
  | "all"
  | "active"
  | "overdue"
  | "returned"
  | "historical";

const FILTERS: Array<{
  id: StatusFilter;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "active", label: "On rent" },
  { id: "overdue", label: "Overdue" },
  { id: "returned", label: "Returned" },
  {
    id: "historical",
    label: "Past (entered)",
  },
];

const STATUS_LABEL: Record<
  RentalRecord["status"],
  string
> = {
  active: "On rent",
  overdue: "Overdue",
  returned: "Returned",
  historical: "Past booking",
};

/*
 * The pill classes the rest of the application already uses
 * for a vehicle's state, so a rental reads the same way a
 * fleet row does.
 */
const STATUS_TONE: Record<
  RentalRecord["status"],
  string
> = {
  active: "rented",
  overdue: "overdue",
  returned: "available",
  historical: "cleaning",
};

function moment(
  value: string | null,
): string {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return "Not recorded";
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function RentalRecords({
  limit = 200,
}: {
  limit?: number;
}) {
  const [records, setRecords] = useState<
    RentalRecord[]
  >([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string>();

  const [search, setSearch] =
    useState("");

  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("all");

  const [reloadToken, setReloadToken] =
    useState(0);

  /*
   * Opening a row is how the desk pulls up the paperwork:
   * the agreement, the renter's licence and the condition
   * photographs from each end of the hire.
   */
  const [openRentalId, setOpenRentalId] =
    useState<string>();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      try {
        const result =
          await callFirestoreOperation<
            { limit: number },
            RentalRecord[]
          >("listRentalRecords", {
            limit,
          });

        if (cancelled) {
          return;
        }

        setRecords(result);
        setError(undefined);
      } catch (cause) {
        if (!cancelled) {
          setRecords([]);

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

    /*
     * A refresh while a read is in flight would otherwise let
     * the older response overwrite the newer one.
     */
    return () => {
      cancelled = true;
    };
  }, [limit, reloadToken]);

  const visible = useMemo(() => {
    const needle = search
      .trim()
      .toLowerCase();

    return records.filter((record) => {
      if (
        statusFilter !== "all" &&
        record.status !== statusFilter
      ) {
        return false;
      }

      if (!needle) {
        return true;
      }

      /*
       * One box searches the customer, the vehicle and every
       * employee attached to the rental: the administrator
       * asking "who rented this car out" should not have to
       * pick a column first.
       */
      return [
        record.customerName,
        record.vehicleRegistration,
        record.bookedByName,
        record.checkedOutByName,
        record.returnedByName,
        STATUS_LABEL[record.status],
      ]
        .filter(Boolean)
        .some((value) =>
          String(value)
            .toLowerCase()
            .includes(needle),
        );
    });
  }, [
    records,
    search,
    statusFilter,
  ]);

  const counts = useMemo(() => {
    const tally: Record<string, number> = {
      all: records.length,
      active: 0,
      overdue: 0,
      returned: 0,
      historical: 0,
    };

    for (const record of records) {
      tally[record.status] += 1;
    }

    return tally;
  }, [records]);

  return (
    <div className="rental-records">
      {error && (
        <div
          className="alert alert-error"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="surface-toolbar">
        <div className="search-box">
          <Search size={17} />

          <input
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Search customer, vehicle or staff member"
            aria-label="Search rental records"
          />
        </div>

        <span className="customer-count">
          {`${visible.length} record${
            visible.length === 1 ? "" : "s"
          }`}
        </span>

        <button
          className="button button-secondary compact"
          type="button"
          disabled={loading}
          onClick={() =>
            setReloadToken(
              (token) => token + 1,
            )
          }
        >
          <RefreshCw
            className={
              loading ? "spin" : undefined
            }
            size={15}
          />
          Refresh
        </button>
      </div>

      <div className="filter-scroll">
        {FILTERS.map((filter) => (
          <button
            type="button"
            key={filter.id}
            className={`filter-chip${
              statusFilter === filter.id
                ? " active"
                : ""
            }`}
            onClick={() =>
              setStatusFilter(filter.id)
            }
          >
            {filter.label}
            <span>
              {counts[filter.id] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div
          className="inline-empty"
          role="status"
          aria-live="polite"
        >
          Loading rental records…
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <div className="empty-illustration">
            <CalendarRange size={23} />
          </div>

          <h2>No rental records</h2>

          <p>
            {records.length === 0
              ? "No vehicle has been checked out yet, and no past booking has been entered."
              : "No rental matches this search."}
          </p>
        </div>
      ) : (
        <div className="table-wrap customer-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Vehicle</th>
                <th>Staff member</th>
                <th>Rental start</th>
                <th>Return</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {visible.map((record) => (
                <tr key={record.rentalId}>
                  <td>
                    <button
                      type="button"
                      className="text-button history-open"
                      title={`Open the rental file for ${record.customerName}`}
                      onClick={() =>
                        setOpenRentalId(
                          record.rentalId,
                        )
                      }
                    >
                      {record.customerName}
                    </button>
                  </td>

                  <td>
                    <strong>
                      {
                        record.vehicleRegistration
                      }
                    </strong>
                  </td>

                  <td>
                    <strong>
                      {
                        record.checkedOutByName
                      }
                    </strong>

                    <span>
                      {record.bookedByName ===
                      record.checkedOutByName
                        ? "Booked and handed over"
                        : `Booked by ${record.bookedByName}`}
                    </span>

                    {record.returnedByName && (
                      <small>
                        {`Returned to ${record.returnedByName}`}
                      </small>
                    )}
                  </td>

                  <td>
                    {moment(record.pickupAt)}
                  </td>

                  <td>
                    <strong>
                      {moment(
                        record.actualReturnAt ??
                          record.expectedReturnAt,
                      )}
                    </strong>

                    <span>
                      {record.actualReturnAt
                        ? "Returned"
                        : "Due back"}
                    </span>
                  </td>

                  <td>
                    <span
                      className={`status-pill ${
                        STATUS_TONE[
                          record.status
                        ]
                      }`}
                    >
                      {
                        STATUS_LABEL[
                          record.status
                        ]
                      }
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openRentalId && (
        <RentalAgreement
          rentalId={openRentalId}
          onClose={() =>
            setOpenRentalId(undefined)
          }
        />
      )}
    </div>
  );
}
