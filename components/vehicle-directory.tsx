"use client";

import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";

import {
  CarFront,
  CheckCircle2,
  FileWarning,
  Pencil,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  VehicleDocument,
  VehicleStatus,
} from "@/packages/domain/src/types";

import { getFirebaseClient } from "@/lib/firebase/client";

import {
  firebaseErrorMessage,
  formatDate,
  formatMoney,
} from "@/lib/presentation";

import {
  callFirestoreOperation,
} from "@/lib/services/firestore-client";

import { AppShell } from "./app-shell";

type Vehicle = VehicleDocument & {
  id: string;
};

type VehicleForm = {
  registrationNumber: string;
  make: string;
  model: string;
  year: string;
  color: string;
  vin: string;
  registrationExpiresAt: string;
  insuranceExpiresAt: string;
  lastServiceAt: string;
  nextServiceDueAt: string;
  dailyCents: string;
  weeklyCents: string;
  monthlyCents: string;
  notes: string;
};

const statuses: Array<
  VehicleStatus | "all"
> = [
  "all",
  "available",
  "reserved",
  "rented",
  "overdue",
  "cleaning",
  "maintenance",
  "out_of_service",
];

function label(status: string): string {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase(),
    );
}

function toInputDate(
  value: string | null,
): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return value.length >= 10
      ? value.slice(0, 10)
      : "";
  }

  return date
    .toISOString()
    .slice(0, 10);
}

function vehicleToForm(
  vehicle: Vehicle,
): VehicleForm {
  return {
    registrationNumber:
      vehicle.registrationNumber ?? "",

    make:
      vehicle.make ?? "",

    model:
      vehicle.model ?? "",

    year:
      vehicle.year == null
        ? ""
        : String(vehicle.year),

    color:
      vehicle.color ?? "",

    vin:
      vehicle.vin ?? "",

    registrationExpiresAt:
      toInputDate(
        vehicle.registrationExpiresAt,
      ),

    insuranceExpiresAt:
      toInputDate(
        vehicle.insuranceExpiresAt,
      ),

    lastServiceAt:
      toInputDate(
        vehicle.lastServiceAt,
      ),

    nextServiceDueAt:
      toInputDate(
        vehicle.nextServiceDueAt,
      ),

    dailyCents:
      vehicle.rates.dailyCents == null
        ? ""
        : String(
            vehicle.rates.dailyCents / 100,
          ),

    weeklyCents:
      vehicle.rates.weeklyCents == null
        ? ""
        : String(
            vehicle.rates.weeklyCents / 100,
          ),

    monthlyCents:
      vehicle.rates.monthlyCents == null
        ? ""
        : String(
            vehicle.rates.monthlyCents / 100,
          ),

    notes:
      vehicle.notes ?? "",
  };
}

function dateIsValid(
  value: string,
): boolean {
  return (
    !value ||
    !Number.isNaN(
      new Date(value).valueOf(),
    )
  );
}

function centsFromInput(
  value: string,
): number | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const number = Number(trimmed);

  if (
    !Number.isFinite(number) ||
    number < 0
  ) {
    throw new Error(
      "Rates must be non-negative numbers.",
    );
  }

  return Math.round(number * 100);
}

export function VehicleDirectory() {
  const [vehicles, setVehicles] =
    useState<Vehicle[]>([]);

  const [error, setError] =
    useState<string>();

  const [notice, setNotice] =
    useState<string>();

  const [search, setSearch] =
    useState("");

  const [status, setStatus] =
    useState<
      VehicleStatus | "all"
    >("all");

  const [editingVehicle, setEditingVehicle] =
    useState<Vehicle | null>(null);

  const [form, setForm] =
    useState<VehicleForm | null>(null);

  const [saving, setSaving] =
    useState(false);

  const [busyVehicleId, setBusyVehicleId] =
    useState<string>();

  useEffect(() => {
    const source = query(
      collection(
        getFirebaseClient().db,
        "vehicles",
      ),
      orderBy("registrationNumber"),
      limit(100),
    );

    return onSnapshot(
      source,
      (snapshot) => {
        setVehicles(
          snapshot.docs.map(
            (item) =>
              ({
                id: item.id,
                ...item.data(),
              }) as Vehicle,
          ),
        );

        setError(undefined);
      },
      () => {
        setError(
          "Fleet records are unavailable. Check your access and try again.",
        );
      },
    );
  }, []);

  const filtered = useMemo(() => {
    const needle =
      search.trim().toLowerCase();

    return vehicles.filter(
      (vehicle) =>
        (status === "all" ||
          vehicle.status === status) &&
        (!needle ||
          `${vehicle.registrationNumber} ${
            vehicle.make
          } ${
            vehicle.model
          } ${vehicle.vin ?? ""}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [
    vehicles,
    search,
    status,
  ]);

  const statusCount = (
    item: VehicleStatus,
  ) =>
    vehicles.filter(
      (vehicle) =>
        vehicle.status === item,
    ).length;

  function openEditor(vehicle: Vehicle) {
    setError(undefined);
    setNotice(undefined);
    setEditingVehicle(vehicle);
    setForm(vehicleToForm(vehicle));
  }

  function closeEditor() {
    if (saving) {
      return;
    }

    setEditingVehicle(null);
    setForm(null);
  }

  function updateForm(
    field: keyof VehicleForm,
    value: string,
  ) {
    setForm((current) =>
      current
        ? {
            ...current,
            [field]: value,
          }
        : current,
    );
  }

  async function saveVehicle() {
    if (!editingVehicle || !form) {
      return;
    }

    setError(undefined);
    setNotice(undefined);

    try {
      if (!form.registrationNumber.trim()) {
        throw new Error(
          "Registration number is required.",
        );
      }

      if (!form.make.trim()) {
        throw new Error(
          "Make is required.",
        );
      }

      if (!form.model.trim()) {
        throw new Error(
          "Model is required.",
        );
      }

      if (form.year.trim()) {
        const year =
          Number(form.year);

        if (
          !Number.isInteger(year) ||
          year < 1886 ||
          year >
            new Date().getFullYear() + 1
        ) {
          throw new Error(
            "Enter a valid vehicle year.",
          );
        }
      }

      if (
        form.registrationExpiresAt &&
        !dateIsValid(
          form.registrationExpiresAt,
        )
      ) {
        throw new Error(
          "Registration expiry date is invalid.",
        );
      }

      if (
        form.insuranceExpiresAt &&
        !dateIsValid(
          form.insuranceExpiresAt,
        )
      ) {
        throw new Error(
          "Insurance expiry date is invalid.",
        );
      }

      if (
        form.lastServiceAt &&
        !dateIsValid(
          form.lastServiceAt,
        )
      ) {
        throw new Error(
          "Last service date is invalid.",
        );
      }

      if (
        form.nextServiceDueAt &&
        !dateIsValid(
          form.nextServiceDueAt,
        )
      ) {
        throw new Error(
          "Next service date is invalid.",
        );
      }

      if (
        form.vin.trim() &&
        form.vin.trim().length !== 17
      ) {
        throw new Error(
          "VIN must contain 17 characters.",
        );
      }

      setSaving(true);

      await callFirestoreOperation<
        Record<string, unknown>,
        void
      >(
        "updateVehicleDetails",
        {
          vehicleId:
            editingVehicle.id,

          registrationNumber:
            form.registrationNumber
              .trim()
              .toUpperCase(),

          make:
            form.make
              .trim()
              .toUpperCase(),

          model:
            form.model.trim(),

          year:
            form.year.trim()
              ? Number(form.year)
              : null,

          color:
            form.color.trim() ||
            null,

          vin:
            form.vin.trim()
              ? form.vin
                  .trim()
                  .toUpperCase()
              : null,

          registrationExpiresAt:
            form.registrationExpiresAt ||
            null,

          insuranceExpiresAt:
            form.insuranceExpiresAt ||
            null,

          lastServiceAt:
            form.lastServiceAt ||
            null,

          nextServiceDueAt:
            form.nextServiceDueAt ||
            null,

          dailyCents:
            centsFromInput(
              form.dailyCents,
            ),

          weeklyCents:
            centsFromInput(
              form.weeklyCents,
            ),

          monthlyCents:
            centsFromInput(
              form.monthlyCents,
            ),

          notes:
            form.notes.trim() ||
            null,
        },
      );

      setNotice(
        `${form.registrationNumber.toUpperCase()} updated successfully.`,
      );

      setEditingVehicle(null);
      setForm(null);
    } catch (cause) {
      setError(
        firebaseErrorMessage(cause),
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(
    vehicle: Vehicle,
    nextStatus: VehicleStatus,
  ) {
    if (
      nextStatus === vehicle.status
    ) {
      return;
    }

    setError(undefined);
    setNotice(undefined);
    setBusyVehicleId(vehicle.id);

    try {
      await callFirestoreOperation<
        {
          vehicleId: string;
          status: VehicleStatus;
          note: string;
        },
        void
      >(
        "changeVehicleStatus",
        {
          vehicleId: vehicle.id,
          status: nextStatus,
          note: `Status changed from ${label(
            vehicle.status,
          )} to ${label(
            nextStatus,
          )} from Fleet.`,
        },
      );

      setNotice(
        `${vehicle.registrationNumber} changed to ${label(
          nextStatus,
        )}.`,
      );
    } catch (cause) {
      setError(
        firebaseErrorMessage(cause),
      );
    } finally {
      setBusyVehicleId(
        undefined,
      );
    }
  }

  return (
    <AppShell
      title="Fleet"
      eyebrow={`${vehicles.length} vehicle${
        vehicles.length === 1
          ? ""
          : "s"
      } in inventory`}
    >
      <section className="fleet-summary">
        <div>
          <CarFront size={19} />

          <span>
            <strong>
              {statusCount(
                "available",
              )}
            </strong>{" "}
            available
          </span>
        </div>

        <div>
          <ShieldCheck size={19} />

          <span>
            <strong>
              {statusCount(
                "rented",
              )}
            </strong>{" "}
            on rent
          </span>
        </div>

        <div>
          <FileWarning size={19} />

          <span>
            <strong>
              {statusCount(
                "maintenance",
              ) +
                statusCount(
                  "out_of_service",
                )}
            </strong>{" "}
            unavailable
          </span>
        </div>
      </section>

      {error && (
        <div
          className="alert alert-error"
          role="alert"
        >
          <FileWarning
            size={18}
          />
          {error}
        </div>
      )}

      {notice && (
        <div
          className="alert alert-success"
          role="status"
        >
          <CheckCircle2
            size={18}
          />
          {notice}
        </div>
      )}

      <section className="surface fleet-surface">
        <div className="surface-toolbar">
          <div className="search-box">
            <Search size={18} />

            <input
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value,
                )
              }
              placeholder="Search registration, make or VIN"
              aria-label="Search fleet"
            />
          </div>

          <div
            className="filter-scroll"
            aria-label="Fleet status filter"
          >
            {statuses.map((item) => (
              <button
                type="button"
                className={
                  status === item
                    ? "filter-chip active"
                    : "filter-chip"
                }
                onClick={() =>
                  setStatus(item)
                }
                key={item}
              >
                {item === "all"
                  ? "All"
                  : label(item)}

                {item !== "all" && (
                  <span>
                    {statusCount(item)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {filtered.length ? (
          <>
            <div className="table-wrap fleet-table">
              <table>
                <thead>
                  <tr>
                    <th>
                      Vehicle
                    </th>

                    <th>
                      Registration
                    </th>

                    <th>VIN</th>

                    <th>
                      Insurance
                    </th>

                    <th>
                      Registration
                    </th>

                    <th>
                      Daily rate
                    </th>

                    <th>Status</th>

                    <th />
                  </tr>
                </thead>

                <tbody>
                  {filtered.map(
                    (vehicle) => {
                      const busy =
                        busyVehicleId ===
                        vehicle.id;

                      const registrationValid =
                        Boolean(
                          vehicle.registrationExpiresAt,
                        ) &&
                        !Number.isNaN(
                          new Date(
                            vehicle.registrationExpiresAt as string,
                          ).valueOf(),
                        ) &&
                        new Date(
                          vehicle.registrationExpiresAt as string,
                        ).getTime() >
                          Date.now();

                      const insuranceValid =
                        Boolean(
                          vehicle.insuranceExpiresAt,
                        ) &&
                        !Number.isNaN(
                          new Date(
                            vehicle.insuranceExpiresAt as string,
                          ).valueOf(),
                        ) &&
                        new Date(
                          vehicle.insuranceExpiresAt as string,
                        ).getTime() >
                          Date.now();

                      return (
                        <tr
                          key={
                            vehicle.id
                          }
                        >
                          <td>
                            <strong>
                              {
                                vehicle.make
                              }{" "}
                              {
                                vehicle.model
                              }
                            </strong>

                            <span>
                              {vehicle.year ??
                                "Year pending"}{" "}
                              ·{" "}
                              {vehicle.color ??
                                "Colour pending"}
                            </span>
                          </td>

                          <td>
                            <strong>
                              {
                                vehicle.registrationNumber
                              }
                            </strong>
                          </td>

                          <td
                            className={
                              vehicle.vin
                                ? "mono"
                                : "missing"
                            }
                          >
                            {vehicle.vin ??
                              "VIN pending"}
                          </td>

                          <td
                            className={
                              insuranceValid
                                ? ""
                                : "missing"
                            }
                          >
                            {formatDate(
                              vehicle.insuranceExpiresAt,
                            )}
                          </td>

                          <td
                            className={
                              registrationValid
                                ? ""
                                : "missing"
                            }
                          >
                            {formatDate(
                              vehicle.registrationExpiresAt,
                            )}
                          </td>

                          <td>
                            {vehicle
                              .rates
                              .dailyCents ===
                            null ? (
                              <span className="missing">
                                Pending
                              </span>
                            ) : (
                              formatMoney(
                                vehicle
                                  .rates
                                  .dailyCents,
                              )
                            )}
                          </td>

                          <td>
                            <div className="fleet-status-control">
                              <span
                                className={`status-pill ${vehicle.status}`}
                              >
                                {label(
                                  vehicle.status,
                                )}
                              </span>

                              <select
                                value={
                                  vehicle.status
                                }
                                disabled={
                                  busy
                                }
                                aria-label={`Change status for ${vehicle.registrationNumber}`}
                                onChange={(
                                  event,
                                ) =>
                                  void changeStatus(
                                    vehicle,
                                    event
                                      .target
                                      .value as VehicleStatus,
                                  )
                                }
                              >
                                {statuses
                                  .filter(
                                    (
                                      item,
                                    ): item is VehicleStatus =>
                                      item !==
                                      "all",
                                  )
                                  .map(
                                    (
                                      item,
                                    ) => (
                                      <option
                                        key={
                                          item
                                        }
                                        value={
                                          item
                                        }
                                      >
                                        {label(
                                          item,
                                        )}
                                      </option>
                                    ),
                                  )}
                              </select>
                            </div>
                          </td>

                          <td>
                            <button
                              className="button button-secondary compact"
                              type="button"
                              onClick={() =>
                                openEditor(
                                  vehicle,
                                )
                              }
                            >
                              <Pencil
                                size={15}
                              />
                              Edit
                            </button>
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>

            <div className="fleet-cards">
              {filtered.map(
                (vehicle) => {
                  const busy =
                    busyVehicleId ===
                    vehicle.id;

                  return (
                    <article
                      className="vehicle-card"
                      key={
                        vehicle.id
                      }
                    >
                      <div>
                        <span
                          className={`status-pill ${vehicle.status}`}
                        >
                          {label(
                            vehicle.status,
                          )}
                        </span>

                        <strong>
                          {
                            vehicle.registrationNumber
                          }
                        </strong>

                        <p>
                          {
                            vehicle.make
                          }{" "}
                          {
                            vehicle.model
                          }
                        </p>
                      </div>

                      <button
                        className="icon-button"
                        type="button"
                        onClick={() =>
                          openEditor(
                            vehicle,
                          )
                        }
                        aria-label={`Edit ${vehicle.registrationNumber}`}
                      >
                        <Pencil
                          size={17}
                        />
                      </button>

                      <dl>
                        <div>
                          <dt>
                            Insurance
                          </dt>

                          <dd>
                            {formatDate(
                              vehicle.insuranceExpiresAt,
                            )}
                          </dd>
                        </div>

                        <div>
                          <dt>
                            Registration
                          </dt>

                          <dd>
                            {formatDate(
                              vehicle.registrationExpiresAt,
                            )}
                          </dd>
                        </div>

                        <div>
                          <dt>
                            Daily rate
                          </dt>

                          <dd>
                            {vehicle
                              .rates
                              .dailyCents ===
                            null
                              ? "Pending"
                              : formatMoney(
                                  vehicle
                                    .rates
                                    .dailyCents,
                                )}
                          </dd>
                        </div>
                      </dl>

                      <select
                        value={
                          vehicle.status
                        }
                        disabled={
                          busy
                        }
                        aria-label={`Change status for ${vehicle.registrationNumber}`}
                        onChange={(
                          event,
                        ) =>
                          void changeStatus(
                            vehicle,
                            event
                              .target
                              .value as VehicleStatus,
                          )
                        }
                      >
                        {statuses
                          .filter(
                            (
                              item,
                            ): item is VehicleStatus =>
                              item !==
                              "all",
                          )
                          .map(
                            (
                              item,
                            ) => (
                              <option
                                key={
                                  item
                                }
                                value={
                                  item
                                }
                              >
                                {label(
                                  item,
                                )}
                              </option>
                            ),
                          )}
                      </select>
                    </article>
                  );
                },
              )}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-illustration">
              <CarFront />
            </div>

            <div>
              <h2>
                {vehicles.length
                  ? "No vehicles match this view"
                  : "No fleet records yet"}
              </h2>

              <p>
                {vehicles.length
                  ? "Try a different search or status."
                  : "Import the supplied inventory from the setup guide, then verify its missing compliance details."}
              </p>
            </div>
          </div>
        )}
      </section>

      {editingVehicle &&
        form && (
          <div
            className="vehicle-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (
                event.currentTarget ===
                event.target
              ) {
                closeEditor();
              }
            }}
          >
            <section
              className="vehicle-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="vehicle-editor-title"
            >
              <header className="vehicle-modal-header">
                <div>
                  <p className="page-kicker">
                    Fleet record
                  </p>

                  <h2 id="vehicle-editor-title">
                    Edit{" "}
                    {
                      editingVehicle.registrationNumber
                    }
                  </h2>
                </div>

                <button
                  className="icon-button"
                  type="button"
                  onClick={
                    closeEditor
                  }
                  disabled={saving}
                  aria-label="Close vehicle editor"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="vehicle-compliance-banner">
                <div>
                  {form.registrationExpiresAt ? (
                    <CheckCircle2
                      size={17}
                    />
                  ) : (
                    <FileWarning
                      size={17}
                    />
                  )}

                  <span>
                    Registration expiry:{" "}
                    <strong>
                      {form.registrationExpiresAt ||
                        "Missing"}
                    </strong>
                  </span>
                </div>

                <div>
                  {form.insuranceExpiresAt ? (
                    <CheckCircle2
                      size={17}
                    />
                  ) : (
                    <FileWarning
                      size={17}
                    />
                  )}

                  <span>
                    Insurance expiry:{" "}
                    <strong>
                      {form.insuranceExpiresAt ||
                        "Missing"}
                    </strong>
                  </span>
                </div>
              </div>

              <div className="vehicle-editor-grid">
                <div className="field">
                  <label>
                    Registration number
                  </label>

                  <input
                    value={
                      form.registrationNumber
                    }
                    onChange={(event) =>
                      updateForm(
                        "registrationNumber",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label>
                    VIN
                  </label>

                  <input
                    value={form.vin}
                    onChange={(event) =>
                      updateForm(
                        "vin",
                        event.target.value,
                      )
                    }
                    maxLength={17}
                  />
                </div>

                <div className="field">
                  <label>Make</label>

                  <input
                    value={form.make}
                    onChange={(event) =>
                      updateForm(
                        "make",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label>Model</label>

                  <input
                    value={form.model}
                    onChange={(event) =>
                      updateForm(
                        "model",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label>Year</label>

                  <input
                    type="number"
                    min="1886"
                    max={
                      new Date().getFullYear() +
                      1
                    }
                    value={form.year}
                    onChange={(event) =>
                      updateForm(
                        "year",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label>
                    Colour
                  </label>

                  <input
                    value={form.color}
                    onChange={(event) =>
                      updateForm(
                        "color",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label>
                    Registration expiry
                  </label>

                  <input
                    type="date"
                    value={
                      form.registrationExpiresAt
                    }
                    onChange={(event) =>
                      updateForm(
                        "registrationExpiresAt",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label>
                    Insurance expiry
                  </label>

                  <input
                    type="date"
                    value={
                      form.insuranceExpiresAt
                    }
                    onChange={(event) =>
                      updateForm(
                        "insuranceExpiresAt",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label>
                    Last service
                  </label>

                  <input
                    type="date"
                    value={
                      form.lastServiceAt
                    }
                    onChange={(event) =>
                      updateForm(
                        "lastServiceAt",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label>
                    Next service due
                  </label>

                  <input
                    type="date"
                    value={
                      form.nextServiceDueAt
                    }
                    onChange={(event) =>
                      updateForm(
                        "nextServiceDueAt",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label>
                    Daily rate
                  </label>

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      form.dailyCents
                    }
                    onChange={(event) =>
                      updateForm(
                        "dailyCents",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label>
                    Weekly rate
                  </label>

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      form.weeklyCents
                    }
                    onChange={(event) =>
                      updateForm(
                        "weeklyCents",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label>
                    Monthly rate
                  </label>

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      form.monthlyCents
                    }
                    onChange={(event) =>
                      updateForm(
                        "monthlyCents",
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field full">
                  <label>
                    Notes
                  </label>

                  <textarea
                    value={form.notes}
                    onChange={(event) =>
                      updateForm(
                        "notes",
                        event.target.value,
                      )
                    }
                  />
                </div>
              </div>

              <footer className="vehicle-modal-footer">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={
                    closeEditor
                  }
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  className="button button-primary"
                  type="button"
                  onClick={() =>
                    void saveVehicle()
                  }
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : "Save vehicle"}
                </button>
              </footer>
            </section>
          </div>
        )}
    </AppShell>
  );
}