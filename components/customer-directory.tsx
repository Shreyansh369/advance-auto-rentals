"use client";

import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import {
  CarFront,
  Pencil,
  Plus,
  Search,
  UserRound,
  X,
} from "lucide-react";

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import { AppShell } from "./app-shell";
import { CountrySelect } from "./country-select";
import { CustomerLicenseCapture } from "./customer-license-capture";

import { getFirebaseClient } from "@/lib/firebase/client";

import {
  firebaseErrorMessage,
  formatDate,
} from "@/lib/presentation";

import {
  callFirestoreOperation,
} from "@/lib/services/firestore-client";

type Customer = {
  id: string;
  fullName: string;
  telephone: string;
  email: string | null;
  address: string | null;
  licenceNumber: string;
  licenceCountry: string;
  licenceExpiresAt: string | null;
  licenceStoragePath: string | null;
};

type CustomerForm = {
  fullName: string;
  telephone: string;
  email: string;
  address: string;
  licenceNumber: string;
  licenceCountry: string;
  licenceExpiresAt: string;
  licenceStoragePath: string | null;
};

type ActiveRental = {
  id: string;
  customerName: string;
  vehicleRegistration: string;
  expectedReturnAt: Date | null;
  bookedBy: string;
  checkedOutBy: string;
  status: "active" | "overdue";
};

type CustomerTab =
  | "customers"
  | "active-rentals";

function tomorrowDate(): string {
  const value = new Date();

  value.setDate(
    value.getDate() + 1,
  );

  const year =
    value.getFullYear();

  const month =
    String(
      value.getMonth() + 1,
    ).padStart(2, "0");

  const day =
    String(
      value.getDate(),
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function customerToForm(
  customer: Customer,
): CustomerForm {
  return {
    fullName:
      customer.fullName,
    telephone:
      customer.telephone,
    email:
      customer.email ?? "",
    address:
      customer.address ?? "",
    licenceNumber:
      customer.licenceNumber,
    licenceCountry:
      customer.licenceCountry,
    licenceExpiresAt:
      customer.licenceExpiresAt
        ? customer.licenceExpiresAt.slice(
            0,
            10,
          )
        : "",
    licenceStoragePath:
      customer.licenceStoragePath,
  };
}

function emptyCustomerForm(): CustomerForm {
  return {
    fullName: "",
    telephone: "",
    email: "",
    address: "",
    licenceNumber: "",
    licenceCountry: "",
    licenceExpiresAt: "",
    licenceStoragePath: null,
  };
}

function asDate(
  value: unknown,
): Date | null {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value
  ) {
    const timestamp =
      value as {
        toDate?: () => Date;
      };

    if (
      typeof timestamp.toDate ===
      "function"
    ) {
      return timestamp.toDate();
    }
  }

  if (value instanceof Date) {
    return value;
  }

  if (
    typeof value ===
    "string"
  ) {
    const date =
      new Date(value);

    return Number.isNaN(
      date.getTime(),
    )
      ? null
      : date;
  }

  return null;
}

function formatRentalDate(
  value: Date | null,
): string {
  if (!value) {
    return "Not recorded";
  }

  return value.toLocaleString(
    undefined,
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  );
}

export function CustomerDirectory() {
  const [tab, setTab] =
    useState<CustomerTab>(
      "customers",
    );

  const [customers, setCustomers] =
    useState<Customer[]>([]);

  const [activeRentals, setActiveRentals] =
    useState<ActiveRental[]>([]);

  const [search, setSearch] =
    useState("");

  const [rentalSearch, setRentalSearch] =
    useState("");

  const [error, setError] =
    useState<string>();

  const [notice, setNotice] =
    useState<string>();

  const [loading, setLoading] =
    useState(true);

  const [loadingRentals, setLoadingRentals] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [editingSaving, setEditingSaving] =
    useState(false);

  const [showCreateForm, setShowCreateForm] =
    useState(false);

  const [editingCustomerId, setEditingCustomerId] =
    useState<string | null>(null);

  const [editingCustomerForm, setEditingCustomerForm] =
    useState<CustomerForm>(
      emptyCustomerForm(),
    );

  const [rentalsLoaded, setRentalsLoaded] =
    useState(false);

  const [rentalsReloadToken, setRentalsReloadToken] =
    useState(0);

  useEffect(() => {
    const source = query(
      collection(
        getFirebaseClient().db,
        "customers",
      ),
      orderBy("fullName"),
      limit(500),
    );

    return onSnapshot(
      source,
      (snapshot) => {
        setCustomers(
          snapshot.docs.map(
            (customerDoc) => ({
              id: customerDoc.id,

              fullName:
                customerDoc.get(
                  "fullName",
                ),

              telephone:
                customerDoc.get(
                  "telephone",
                ),

              email:
                customerDoc.get(
                  "email",
                ) ?? null,

              address:
                customerDoc.get(
                  "address",
                ) ?? null,

              licenceNumber:
                customerDoc.get(
                  "licenceNumber",
                ),

              licenceCountry:
                customerDoc.get(
                  "licenceCountry",
                ),

              licenceExpiresAt:
                customerDoc.get(
                  "licenceExpiresAt",
                ) ?? null,

              licenceStoragePath:
                customerDoc.get(
                  "licenceStoragePath",
                ) ?? null,
            }),
          ),
        );

        setError(undefined);
        setLoading(false);
      },
      (cause) => {
        console.error(
          "Customer directory listener failed:",
          cause,
        );

        setError(
          firebaseErrorMessage(
            cause,
          ),
        );

        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    if (
      tab !== "active-rentals"
    ) {
      return;
    }

    let cancelled = false;

    async function loadActiveRentals() {
      try {
        const snapshot =
          await getDocs(
            query(
              collection(
                getFirebaseClient().db,
                "rentals",
              ),
              where(
                "status",
                "in",
                [
                  "active",
                  "overdue",
                ],
              ),
              limit(100),
            ),
          );

        const records =
          snapshot.docs
            .map(
              (rentalDoc) => {
                const expectedReturn =
                  asDate(
                    rentalDoc.get(
                      "expectedReturnAt",
                    ),
                  );

                const status =
                  String(
                    rentalDoc.get(
                      "status",
                    ),
                  ) ===
                  "overdue"
                    ? "overdue"
                    : "active";

                return {
                  id:
                    rentalDoc.id,

                  customerName:
                    String(
                      rentalDoc.get(
                        "customerNameSnapshot",
                      ) ??
                        "Unknown customer",
                    ),

                  vehicleRegistration:
                    String(
                      rentalDoc.get(
                        "vehicleRegistrationSnapshot",
                      ) ??
                        "Unknown vehicle",
                    ),

                  expectedReturnAt:
                    expectedReturn,

                  bookedBy:
                    String(
                      rentalDoc.get(
                        "createdByNameSnapshot",
                      ) ??
                        "Not recorded",
                    ),

                  checkedOutBy:
                    String(
                      rentalDoc.get(
                        "checkedOutByNameSnapshot",
                      ) ??
                        "Not recorded",
                    ),

                  status,
                } satisfies ActiveRental;
              },
            )
            .sort(
              (a, b) => {
                const aTime =
                  a.expectedReturnAt?.getTime() ??
                  Number.MAX_SAFE_INTEGER;

                const bTime =
                  b.expectedReturnAt?.getTime() ??
                  Number.MAX_SAFE_INTEGER;

                return (
                  aTime -
                  bTime
                );
              },
            );

        setActiveRentals(
          records,
        );

        setRentalsLoaded(
          true,
        );
      } catch (cause) {
        console.error(
          "Active rental load failed:",
          cause,
        );

        setError(
          firebaseErrorMessage(
            cause,
          ),
        );
      } finally {
        setLoadingRentals(false);
      }
    }

    void loadActiveRentals();

    /*
     * A tab switch or refresh while a read is in flight would
     * otherwise let the older response overwrite the newer one.
     */
    return () => {
      cancelled = true;
    };
  }, [tab, rentalsReloadToken]);

  function refreshActiveRentals() {
    setLoadingRentals(true);
    setError(undefined);
    setRentalsReloadToken(
      (token) => token + 1,
    );
  }

  const filteredCustomers =
    useMemo(() => {
      const needle =
        search
          .trim()
          .toLowerCase();

      if (!needle) {
        return customers;
      }

      return customers.filter(
        (customer) =>
          [
            customer.fullName,
            customer.telephone,
            customer.email,
            customer.licenceNumber,
            customer.licenceCountry,
          ]
            .filter(Boolean)
            .some((value) =>
              String(value)
                .toLowerCase()
                .includes(needle),
            ),
      );
    }, [
      customers,
      search,
    ]);

  const filteredRentals =
    useMemo(() => {
      const needle =
        rentalSearch
          .trim()
          .toLowerCase();

      if (!needle) {
        return activeRentals;
      }

      return activeRentals.filter(
        (rental) =>
          [
            rental.customerName,
            rental.vehicleRegistration,
            rental.bookedBy,
            rental.checkedOutBy,
            rental.status,
          ]
            .filter(Boolean)
            .some((value) =>
              String(value)
                .toLowerCase()
                .includes(needle),
            ),
      );
    }, [
      activeRentals,
      rentalSearch,
    ]);

  function closeEditor() {
    if (editingSaving) {
      return;
    }

    setEditingCustomerId(
      null,
    );

    setEditingCustomerForm(
      emptyCustomerForm(),
    );
  }

  function openEditor(
    customer: Customer,
  ) {
    setError(undefined);
    setNotice(undefined);

    setShowCreateForm(
      false,
    );

    setEditingCustomerId(
      customer.id,
    );

    setEditingCustomerForm(
      customerToForm(customer),
    );
  }

  async function createCustomer(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setError(undefined);
    setNotice(undefined);
    setSaving(true);

    /*
     * React clears currentTarget once the handler returns, so
     * the element is captured before the first await.
     */
    const formElement =
      event.currentTarget;

    const form =
      new FormData(
        formElement,
      );

    const fullName =
      String(
        form.get(
          "fullName",
        ) ?? "",
      ).trim();

    const telephone =
      String(
        form.get(
          "telephone",
        ) ?? "",
      ).trim();

    const emailValue =
      String(
        form.get(
          "email",
        ) ?? "",
      ).trim();

    const addressValue =
      String(
        form.get(
          "address",
        ) ?? "",
      ).trim();

    const licenceNumber =
      String(
        form.get(
          "licenceNumber",
        ) ?? "",
      )
        .trim()
        .toUpperCase();

    const licenceCountry =
      String(
        form.get(
          "licenceCountry",
        ) ?? "",
      )
        .trim()
        .toUpperCase();

    const licenceExpiresAt =
      String(
        form.get(
          "licenceExpiresAt",
        ) ?? "",
      ).trim();

    try {
      if (
        !fullName ||
        !telephone ||
        !licenceNumber ||
        !licenceCountry ||
        !licenceExpiresAt
      ) {
        throw new Error(
          "Complete all required customer details.",
        );
      }

      const today =
        new Date();

      today.setHours(
        0,
        0,
        0,
        0,
      );

      const expiry =
        new Date(
          `${licenceExpiresAt}T00:00:00`,
        );

      expiry.setHours(
        0,
        0,
        0,
        0,
      );

      if (
        Number.isNaN(
          expiry.getTime(),
        ) ||
        expiry.getTime() <=
          today.getTime()
      ) {
        throw new Error(
          "Licence expiry must be after today.",
        );
      }

      if (
        licenceCountry.length !==
        2
      ) {
        throw new Error(
          "Select a valid licence issuing country.",
        );
      }

      const result =
        await callFirestoreOperation<
          {
            fullName: string;
            telephone: string;
            email: string | null;
            address: string | null;
            licenceNumber: string;
            licenceCountry: string;
            licenceExpiresAt: string;
            dateOfBirth:
              string | null;
            notes:
              string | null;
            licenceStoragePath:
              string | null;
          },
          {
            customerId: string;
          }
        >(
          "createOrUpdateCustomer",
          {
            fullName,
            telephone,
            email:
              emailValue ||
              null,
            address:
              addressValue ||
              null,
            licenceNumber,
            licenceCountry,
            licenceExpiresAt,
            dateOfBirth:
              null,
            notes:
              null,
            licenceStoragePath:
              null,
          },
        );

      formElement.reset();

      setShowCreateForm(
        false,
      );

      setEditingCustomerId(
        result.customerId,
      );

      setEditingCustomerForm({
        fullName,
        telephone,
        email:
          emailValue,
        address:
          addressValue,
        licenceNumber,
        licenceCountry,
        licenceExpiresAt,
        licenceStoragePath:
          null,
      });

      setNotice(
        "Customer created. Add or capture the driver's licence photo below.",
      );
    } catch (cause) {
      setError(
        firebaseErrorMessage(
          cause,
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveCustomerEdits(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!editingCustomerId) {
      return;
    }

    setError(undefined);
    setNotice(undefined);
    setEditingSaving(true);

    try {
      const form =
        new FormData(
          event.currentTarget,
        );

      const fullName =
        editingCustomerForm.fullName
          .trim();

      const telephone =
        editingCustomerForm.telephone
          .trim();

      const email =
        editingCustomerForm.email
          .trim();

      const address =
        editingCustomerForm.address
          .trim();

      const licenceNumber =
        editingCustomerForm.licenceNumber
          .trim()
          .toUpperCase();

      const licenceCountry =
        String(
          form.get(
            "licenceCountry",
          ) ?? "",
        )
          .trim()
          .toUpperCase();

      const licenceExpiresAt =
        editingCustomerForm.licenceExpiresAt
          .trim();

      if (
        !fullName ||
        !telephone ||
        !licenceNumber ||
        !licenceCountry ||
        !licenceExpiresAt
      ) {
        throw new Error(
          "Complete all required customer details.",
        );
      }

      const today =
        new Date();

      today.setHours(
        0,
        0,
        0,
        0,
      );

      const expiry =
        new Date(
          `${licenceExpiresAt}T00:00:00`,
        );

      expiry.setHours(
        0,
        0,
        0,
        0,
      );

      if (
        Number.isNaN(
          expiry.getTime(),
        ) ||
        expiry.getTime() <=
          today.getTime()
      ) {
        throw new Error(
          "Licence expiry must be after today.",
        );
      }

      if (
        licenceCountry.length !==
        2
      ) {
        throw new Error(
          "Select a valid licence issuing country.",
        );
      }

      await callFirestoreOperation<
        {
          customerId: string;
          fullName: string;
          telephone: string;
          email: string | null;
          address: string | null;
          licenceNumber: string;
          licenceCountry: string;
          licenceExpiresAt: string;
          dateOfBirth:
            string | null;
          notes:
            string | null;
          licenceStoragePath:
            string | null;
        },
        {
          customerId: string;
        }
      >(
        "createOrUpdateCustomer",
        {
          customerId:
            editingCustomerId,

          fullName,
          telephone,

          email:
            email || null,

          address:
            address || null,

          licenceNumber,
          licenceCountry,
          licenceExpiresAt,

          dateOfBirth:
            null,

          notes:
            null,

          licenceStoragePath:
            editingCustomerForm
              .licenceStoragePath,
        },
      );

      setNotice(
        "Customer details updated successfully.",
      );
    } catch (cause) {
      setError(
        firebaseErrorMessage(
          cause,
        ),
      );
    } finally {
      setEditingSaving(false);
    }
  }

  async function handleLicenceChange(
    storagePath: string | null,
  ) {
    if (!editingCustomerId) {
      return;
    }

    if (!storagePath) {
      setEditingCustomerForm(
        (current) => ({
          ...current,
          licenceStoragePath:
            null,
        }),
      );

      return;
    }

    setError(undefined);
    setNotice(undefined);

    try {
      await callFirestoreOperation<
        {
          customerId: string;
          licenceStoragePath: string;
        },
        {
          customerId: string;
          licenceStoragePath: string;
        }
      >(
        "updateCustomerLicenceDocument",
        {
          customerId:
            editingCustomerId,
          licenceStoragePath:
            storagePath,
        },
      );

      setEditingCustomerForm(
        (current) => ({
          ...current,
          licenceStoragePath:
            storagePath,
        }),
      );

      setNotice(
        "Driver's licence photo saved successfully.",
      );
    } catch (cause) {
      setError(
        firebaseErrorMessage(
          cause,
        ),
      );
    }
  }

  return (
    <AppShell
      title="Customers"
      eyebrow="Customer records"
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
          {notice}
        </div>
      )}

      <section className="customer-surface surface">
        <div className="surface-toolbar">
          <div className="search-box">
            <Search size={17} />

            <input
              value={
                tab === "customers"
                  ? search
                  : rentalSearch
              }
              onChange={(event) => {
                if (
                  tab ===
                  "customers"
                ) {
                  setSearch(
                    event.target.value,
                  );
                } else {
                  setRentalSearch(
                    event.target.value,
                  );
                }
              }}
              placeholder={
                tab === "customers"
                  ? "Search name, telephone or licence"
                  : "Search customer, vehicle or staff"
              }
              aria-label={
                tab === "customers"
                  ? "Search customers"
                  : "Search active rentals"
              }
            />
          </div>

          <span className="customer-count">
            {tab === "customers"
              ? `${filteredCustomers.length} customer${
                  filteredCustomers.length ===
                  1
                    ? ""
                    : "s"
                }`
              : `${filteredRentals.length} active rental${
                  filteredRentals.length ===
                  1
                    ? ""
                    : "s"
                }`}
          </span>

          {tab === "customers" && (
            <button
              className="button button-primary compact"
              type="button"
              onClick={() => {
                setError(undefined);
                setNotice(undefined);

                setEditingCustomerId(
                  null,
                );

                setEditingCustomerForm(
                  emptyCustomerForm(),
                );

                setShowCreateForm(
                  true,
                );
              }}
            >
              <Plus size={16} />
              Add customer
            </button>
          )}

          {tab ===
            "active-rentals" && (
            <button
              className="button button-secondary compact"
              type="button"
              disabled={
                loadingRentals
              }
              onClick={
                refreshActiveRentals
              }
            >
              Refresh
            </button>
          )}
        </div>

        <div
          className="customer-tabs"
          role="tablist"
          aria-label="Customer views"
        >
          <button
            type="button"
            role="tab"
            aria-selected={
              tab ===
              "customers"
            }
            className={
              tab ===
              "customers"
                ? "button button-primary compact"
                : "button button-secondary compact"
            }
            onClick={() =>
              setTab(
                "customers",
              )
            }
          >
            <UserRound
              size={15}
            />
            Customers
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={
              tab ===
              "active-rentals"
            }
            className={
              tab ===
              "active-rentals"
                ? "button button-primary compact"
                : "button button-secondary compact"
            }
            onClick={() =>
              setTab(
                "active-rentals",
              )
            }
          >
            <CarFront
              size={15}
            />
            Active rentals
          </button>
        </div>

        {tab === "customers" && (
          <>
            {showCreateForm && (
              <div className="customer-create-panel">
                <div className="customer-create-header">
                  <div>
                    <p className="section-kicker">
                      New customer
                    </p>

                    <h2>
                      Add customer
                    </h2>

                    <p>
                      Create the customer
                      directly from the
                      Customers screen.
                      After saving, you can
                      capture or upload the
                      driver&apos;s licence photo.
                    </p>
                  </div>

                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => {
                      if (saving) {
                        return;
                      }

                      setShowCreateForm(
                        false,
                      );
                    }}
                    aria-label="Close customer form"
                  >
                    <X size={18} />
                  </button>
                </div>

                <form
                  className="form-grid"
                  onSubmit={
                    createCustomer
                  }
                >
                  <div className="field">
                    <label htmlFor="full-name">
                      Full name
                    </label>

                    <input
                      id="full-name"
                      name="fullName"
                      autoComplete="name"
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="telephone">
                      Telephone
                    </label>

                    <input
                      id="telephone"
                      name="telephone"
                      type="tel"
                      autoComplete="tel"
                      inputMode="tel"
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="email">
                      Email
                    </label>

                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                    />
                  </div>

                  <div className="field full">
                    <label htmlFor="address">
                      Address
                    </label>

                    <input
                      id="address"
                      name="address"
                      autoComplete="street-address"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="licence-number">
                      Licence number
                    </label>

                    <input
                      id="licence-number"
                      name="licenceNumber"
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="issuing-country">
                      Issuing country
                    </label>

                    <CountrySelect
                      id="issuing-country"
                      name="licenceCountry"
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="licence-expiry">
                      Licence expiry
                    </label>

                    <input
                      id="licence-expiry"
                      name="licenceExpiresAt"
                      type="date"
                      min={tomorrowDate()}
                      required
                    />
                  </div>

                  <div className="form-actions">
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={
                        saving
                      }
                      onClick={() =>
                        setShowCreateForm(
                          false,
                        )
                      }
                    >
                      Cancel
                    </button>

                    <button
                      className="button button-primary"
                      type="submit"
                      disabled={
                        saving
                      }
                    >
                      {saving
                        ? "Saving..."
                        : "Save customer"}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {editingCustomerId && (
              <div
                className="customer-create-panel"
                style={{
                  marginTop:
                    "16px",
                }}
              >
                <div className="customer-create-header">
                  <div>
                    <p className="section-kicker">
                      Customer details
                    </p>
                  </div>
                </div>

                <form
                  className="form-grid"
                  onSubmit={
                    saveCustomerEdits
                  }
                >
                  <div className="field">
                    <label htmlFor="full-name-2">
                      Full name
                    </label>

                    <input
                      id="full-name-2"
                      value={
                        editingCustomerForm.fullName
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditingCustomerForm(
                          (
                            current,
                          ) => ({
                            ...current,
                            fullName:
                              event
                                .target
                                .value,
                          }),
                        )
                      }
                      autoComplete="name"
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="telephone-2">
                      Telephone
                    </label>

                    <input
                      id="telephone-2"
                      value={
                        editingCustomerForm.telephone
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditingCustomerForm(
                          (
                            current,
                          ) => ({
                            ...current,
                            telephone:
                              event
                                .target
                                .value,
                          }),
                        )
                      }
                      type="tel"
                      autoComplete="tel"
                      inputMode="tel"
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="email-2">
                      Email
                    </label>

                    <input
                      id="email-2"
                      value={
                        editingCustomerForm.email
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditingCustomerForm(
                          (
                            current,
                          ) => ({
                            ...current,
                            email:
                              event
                                .target
                                .value,
                          }),
                        )
                      }
                      type="email"
                      autoComplete="email"
                    />
                  </div>

                  <div className="field full">
                    <label htmlFor="address-2">
                      Address
                    </label>

                    <input
                      id="address-2"
                      value={
                        editingCustomerForm.address
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditingCustomerForm(
                          (
                            current,
                          ) => ({
                            ...current,
                            address:
                              event
                                .target
                                .value,
                          }),
                        )
                      }
                      autoComplete="street-address"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="licence-number-2">
                      Licence number
                    </label>

                    <input
                      id="licence-number-2"
                      value={
                        editingCustomerForm.licenceNumber
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditingCustomerForm(
                          (
                            current,
                          ) => ({
                            ...current,
                            licenceNumber:
                              event
                                .target
                                .value,
                          }),
                        )
                      }
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="issuing-country-2">
                      Issuing country
                    </label>

                    <CountrySelect
                      id="issuing-country-2"
                      key={`${editingCustomerId}-${editingCustomerForm.licenceCountry}`}
                      name="licenceCountry"
                      defaultValue={
                        editingCustomerForm.licenceCountry
                      }
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="licence-expiry-2">
                      Licence expiry
                    </label>

                    <input
                      id="licence-expiry-2"
                      value={
                        editingCustomerForm.licenceExpiresAt
                      }
                      onChange={(
                        event,
                      ) =>
                        setEditingCustomerForm(
                          (
                            current,
                          ) => ({
                            ...current,
                            licenceExpiresAt:
                              event
                                .target
                                .value,
                          }),
                        )
                      }
                      type="date"
                      min={tomorrowDate()}
                      required
                    />
                  </div>

                  <div className="field full">
                    <CustomerLicenseCapture
                      customerId={
                        editingCustomerId
                      }
                      value={
                        editingCustomerForm.licenceStoragePath
                      }
                      onChange={
                        handleLicenceChange
                      }
                    />
                  </div>

                  <div className="form-actions">
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={
                        editingSaving
                      }
                      onClick={
                        closeEditor
                      }
                    >
                      Cancel
                    </button>

                    <button
                      className="button button-primary"
                      type="submit"
                      disabled={
                        editingSaving
                      }
                    >
                      {editingSaving
                        ? "Saving..."
                        : "Save changes"}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {loading ? (
              <div
                className="inline-empty"
                role="status"
              >
                Loading customer records...
              </div>
            ) : filteredCustomers.length ===
              0 ? (
              <div className="empty-state">
                <div className="empty-illustration">
                  <UserRound
                    size={23}
                  />
                </div>

                <h2>
                  No customer records
                </h2>

                <p>
                  Add the first customer
                  directly from this screen.
                </p>

                <button
                  className="button button-primary"
                  type="button"
                  onClick={() =>
                    setShowCreateForm(
                      true,
                    )
                  }
                >
                  <Plus size={16} />
                  Add customer
                </button>
              </div>
            ) : (
              <div className="table-wrap customer-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        Customer
                      </th>

                      <th>
                        Contact
                      </th>

                      <th>
                        Licence
                      </th>

                      <th>
                        Expires
                      </th>

                      <th>
                        Address
                      </th>

                      <th>
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredCustomers.map(
                      (customer) => (
                        <tr
                          key={
                            customer.id
                          }
                        >
                          <td>
                            <strong>
                              {
                                customer.fullName
                              }
                            </strong>

                            <span>
                              {
                                customer.email ||
                                "No email recorded"
                              }
                            </span>
                          </td>

                          <td>
                            <strong>
                              {
                                customer.telephone
                              }
                            </strong>
                          </td>

                          <td>
                            <strong>
                              {
                                customer.licenceNumber
                              }
                            </strong>

                            <span>
                              {
                                customer.licenceCountry
                              }
                            </span>

                            {customer.licenceStoragePath ? (
                              <small>
                                Licence photo
                                saved
                              </small>
                            ) : (
                              <small className="missing">
                                No licence photo
                              </small>
                            )}
                          </td>

                          <td>
                            {formatDate(
                              customer.licenceExpiresAt,
                            )}
                          </td>

                          <td>
                            {
                              customer.address ||
                              "Not recorded"
                            }
                          </td>

                          <td>
                            <button
                              className="button button-secondary compact"
                              type="button"
                              onClick={() =>
                                openEditor(
                                  customer,
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
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === "active-rentals" && (
          <>
            {loadingRentals ? (
              <div
                className="inline-empty"
                role="status"
                aria-live="polite"
              >
                Loading active rentals...
              </div>
            ) : !rentalsLoaded ||
              filteredRentals.length ===
                0 ? (
              <div className="empty-state">
                <div className="empty-illustration">
                  <CarFront
                    size={23}
                  />
                </div>

                <h2>
                  No active rentals
                </h2>

                <p>
                  There are currently no
                  active or overdue rentals.
                </p>
              </div>
            ) : (
              <div className="table-wrap customer-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        Vehicle
                      </th>

                      <th>
                        Customer
                      </th>

                      <th>
                        Expected return
                      </th>

                      <th>
                        Status
                      </th>

                      <th>
                        Booked by
                      </th>

                      <th>
                        Checked out by
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredRentals.map(
                      (rental) => (
                        <tr
                          key={
                            rental.id
                          }
                        >
                          <td>
                            <strong>
                              {
                                rental.vehicleRegistration
                              }
                            </strong>
                          </td>

                          <td>
                            <strong>
                              {
                                rental.customerName
                              }
                            </strong>
                          </td>

                          <td>
                            {
                              formatRentalDate(
                                rental.expectedReturnAt,
                              )
                            }
                          </td>

                          <td>
                            <span
                              className={
                                rental.status ===
                                "overdue"
                                  ? "status-pill status-danger"
                                  : "status-pill"
                              }
                            >
                              {rental.status ===
                              "overdue"
                                ? "Overdue"
                                : "Active"}
                            </span>
                          </td>

                          <td>
                            {
                              rental.bookedBy
                            }
                          </td>

                          <td>
                            {
                              rental.checkedOutBy
                            }
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}