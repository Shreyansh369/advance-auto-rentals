"use client";

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import {
  CalendarCheck2,
  CalendarClock,
  CarFront,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  Plus,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "./app-shell";
import { MediaCapture } from "./media-capture";

import { getFirebaseClient } from "@/lib/firebase/client";
import {
  firebaseErrorMessage,
  formatFuel,
  formatMoney,
} from "@/lib/presentation";
import type { CloudinaryMedia } from "@/lib/cloudinary";
import { callRentalFunction } from "@/lib/services/functions-client";

type Tab = "booking" | "checkout" | "extend" | "return" | "payment";
type CustomerMode = "existing" | "new";

type Customer = {
  id: string;
  fullName: string;
  telephone: string;
  email: string | null;
  licenceNumber: string;
  licenceCountry: string;
  licenceExpiresAt: string | null;
};

type Vehicle = {
  id: string;
  registrationNumber: string;
  make: string;
  model: string;
  status: string;
};

type Reservation = {
  id: string;
  customerName: string;
  vehicleRegistration: string;
};

type Rental = {
  id: string;
  customerName: string;
  vehicleRegistration: string;
  pickupOdometerKm: number;
  status: string;
};

const tabs: Array<{
  id: Tab;
  label: string;
  icon: typeof CalendarCheck2;
}> = [
  {
    id: "booking",
    label: "New booking",
    icon: CalendarCheck2,
  },
  {
    id: "checkout",
    label: "Checkout",
    icon: CarFront,
  },
  {
    id: "extend",
    label: "Extend",
    icon: CalendarClock,
  },
  {
    id: "return",
    label: "Return",
    icon: ClipboardCheck,
  },
  {
    id: "payment",
    label: "Payment",
    icon: CreditCard,
  },
];

const fuelLevels = [
  "empty",
  "quarter",
  "half",
  "three_quarters",
  "full",
] as const;

function localToIso(value: FormDataEntryValue | null): string {
  const date = new Date(String(value));

  if (Number.isNaN(date.valueOf())) {
    throw new Error("Enter a valid date and time.");
  }

  return date.toISOString();
}

function todayDateTime(): string {
  const value = new Date();

  value.setMinutes(
    value.getMinutes() - value.getTimezoneOffset(),
  );

  return value.toISOString().slice(0, 16);
}

export function ReservationComposer() {
  const [tab, setTab] = useState<Tab>("booking");

  const [customerMode, setCustomerMode] =
    useState<CustomerMode>("existing");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);

  const [bookingMedia, setBookingMedia] =
    useState<CloudinaryMedia[]>([]);

  const [returnMedia, setReturnMedia] =
    useState<CloudinaryMedia[]>([]);

  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  const selectedCustomer = customers.find(
    (customer) => customer.id === selectedCustomerId,
  );

  const filteredCustomers = useMemo(() => {
    const needle = customerSearch.trim().toLowerCase();

    if (!needle) {
      return customers;
    }

    return customers.filter((customer) =>
      [
        customer.fullName,
        customer.telephone,
        customer.email,
        customer.licenceNumber,
      ]
        .filter(Boolean)
        .some((value) =>
          String(value).toLowerCase().includes(needle),
        ),
    );
  }, [customerSearch, customers]);

  async function load() {
    try {
      const db = getFirebaseClient().db;

      const [
        customerDocs,
        vehicleDocs,
        reservationDocs,
        rentalDocs,
      ] = await Promise.all([
        getDocs(
          query(
            collection(db, "customers"),
            orderBy("fullName"),
            limit(500),
          ),
        ),

        getDocs(
          query(
            collection(db, "vehicles"),
            where(
              "status",
              "in",
              ["available", "reserved"],
            ),
            orderBy("registrationNumber"),
            limit(100),
          ),
        ),

        getDocs(
          query(
            collection(db, "reservations"),
            where("status", "==", "confirmed"),
            limit(50),
          ),
        ),

        getDocs(
          query(
            collection(db, "rentals"),
            where(
              "status",
              "in",
              ["active", "overdue"],
            ),
            limit(50),
          ),
        ),
      ]);

      setCustomers(
        customerDocs.docs.map((doc) => ({
          id: doc.id,
          fullName: doc.get("fullName"),
          telephone: doc.get("telephone"),
          email: doc.get("email") ?? null,
          licenceNumber: doc.get("licenceNumber"),
          licenceCountry: doc.get("licenceCountry"),
          licenceExpiresAt:
            doc.get("licenceExpiresAt") ?? null,
        })),
      );

      setVehicles(
        vehicleDocs.docs.map((doc) => ({
          id: doc.id,
          registrationNumber:
            doc.get("registrationNumber"),
          make: doc.get("make"),
          model: doc.get("model"),
          status: doc.get("status"),
        })),
      );

      setReservations(
        reservationDocs.docs.map((doc) => ({
          id: doc.id,
          customerName:
            doc.get("customerNameSnapshot"),
          vehicleRegistration:
            doc.get("vehicleRegistrationSnapshot"),
        })),
      );

      setRentals(
        rentalDocs.docs.map((doc) => ({
          id: doc.id,
          customerName:
            doc.get("customerNameSnapshot"),
          vehicleRegistration:
            doc.get("vehicleRegistrationSnapshot"),
          pickupOdometerKm:
            doc.get("pickupOdometerKm"),
          status: doc.get("status"),
        })),
      );
    } catch (cause) {
      setError(firebaseErrorMessage(cause));
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  async function run(task: () => Promise<string>) {
    setError(undefined);
    setNotice(undefined);
    setBusy(true);

    try {
      setNotice(await task());
      await load();
    } catch (cause) {
      setError(firebaseErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function createReservation(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!selectedCustomerId) {
      setError(
        "Select an existing customer or create a new customer before booking.",
      );
      return;
    }

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    void run(async () => {
      const result = await callRentalFunction<
        {
          customerId: string;
          vehicleId: string;
          pickupAt: string;
          expectedReturnAt: string;
          notes: string | null;
          bookingMedia: CloudinaryMedia[];
        },
        {
          reservationId: string;
          quote: {
            baseRentalCents: number;
            chargedDays: number;
          };
        }
      >("createReservation", {
        customerId: selectedCustomerId,
        vehicleId: String(form.get("vehicleId")),
        pickupAt: localToIso(form.get("pickupAt")),
        expectedReturnAt: localToIso(
          form.get("expectedReturnAt"),
        ),
        notes:
          String(form.get("notes")).trim() || null,
        bookingMedia,
      });

      formElement.reset();

      setSelectedCustomerId("");
      setBookingMedia([]);
      setCustomerSearch("");
      setCustomerMode("existing");

      return `Booking confirmed · ${
        result.quote.chargedDays
      } day(s) · ${formatMoney(
        result.quote.baseRentalCents,
      )}.`;
    });
  }

  function checkout(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    void run(async () => {
      const result = await callRentalFunction<
        {
          reservationId: string;
          pickupFuelLevel: string;
          pickupOdometerKm: number;
          notes: string | null;
        },
        { rentalId: string }
      >("checkoutReservation", {
        reservationId: String(
          form.get("reservationId"),
        ),
        pickupFuelLevel: String(
          form.get("pickupFuelLevel"),
        ),
        pickupOdometerKm: Number(
          form.get("pickupOdometerKm"),
        ),
        notes:
          String(form.get("notes")).trim() || null,
      });

      formElement.reset();

      return `Vehicle checked out · rental ${result.rentalId}.`;
    });
  }

  function extend(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    void run(async () => {
      const result = await callRentalFunction<
        {
          rentalId: string;
          expectedReturnAt: string;
          note: string;
          idempotencyKey: string;
        },
        {
          extensionCents: number;
          outstandingCents: number;
        }
      >("extendRental", {
        rentalId: String(form.get("rentalId")),
        expectedReturnAt: localToIso(
          form.get("expectedReturnAt"),
        ),
        note: String(form.get("note")).trim(),
        idempotencyKey: crypto.randomUUID(),
      });

      formElement.reset();

      return `Rental extended · ${formatMoney(
        result.extensionCents,
      )} added · balance ${formatMoney(
        result.outstandingCents,
      )}.`;
    });
  }

  function completeReturn(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    void run(async () => {
      const amount = String(
        form.get("adjustmentAmount"),
      );

      const adjustments = amount
        ? [
            {
              type: String(
                form.get("adjustmentType"),
              ),
              amountCents: Math.round(
                Number(amount) * 100,
              ),
              note:
                String(
                  form.get("adjustmentNote"),
                ).trim() ||
                "Return adjustment",
            },
          ]
        : [];

      const result = await callRentalFunction<
        {
          rentalId: string;
          actualReturnAt: string;
          returnFuelLevel: string;
          returnOdometerKm: number;
          adjustments: Array<{
            type: string;
            amountCents: number;
            note: string;
          }>;
          notes: string | null;
          returnMedia: CloudinaryMedia[];
        },
        { outstandingCents: number }
      >("returnRental", {
        rentalId: String(form.get("rentalId")),
        actualReturnAt: localToIso(
          form.get("actualReturnAt"),
        ),
        returnFuelLevel: String(
          form.get("returnFuelLevel"),
        ),
        returnOdometerKm: Number(
          form.get("returnOdometerKm"),
        ),
        adjustments,
        notes:
          String(form.get("notes")).trim() || null,
        returnMedia,
      });

      formElement.reset();
      setReturnMedia([]);

      return `Return completed · outstanding balance ${formatMoney(
        result.outstandingCents,
      )}.`;
    });
  }

  function recordPayment(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    void run(async () => {
      const result = await callRentalFunction<
        {
          rentalId: string;
          amountCents: number;
          method: string;
          externalReference: string | null;
          idempotencyKey: string;
        },
        { outstandingCents: number }
      >("recordRentalPayment", {
        rentalId: String(form.get("rentalId")),
        amountCents: Math.round(
          Number(form.get("amount")) * 100,
        ),
        method: String(form.get("method")),
        externalReference:
          String(form.get("reference")).trim() ||
          null,
        idempotencyKey: crypto.randomUUID(),
      });

      formElement.reset();

      return `Payment recorded · outstanding balance ${formatMoney(
        result.outstandingCents,
      )}.`;
    });
  }

  return (
    <AppShell
      title="Bookings"
      eyebrow="Customer and rental desk"
    >
      <section
        className="workflow-tabs"
        aria-label="Rental workflow"
      >
        {tabs.map(
          ({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={
                tab === id ? "active" : ""
              }
              type="button"
              onClick={() => setTab(id)}
            >
              <Icon size={17} />
              {label}
            </button>
          ),
        )}
      </section>

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

      <section className="workflow-shell surface">
        {tab === "booking" && (
          <form
            className="form-grid"
            onSubmit={createReservation}
          >
            <div className="form-section">
              <p className="section-kicker">
                New booking
              </p>

              <h2>Book a vehicle</h2>

              <p>
                Select the customer once, select the
                vehicle once, capture the vehicle
                condition and confirm the reservation.
              </p>
            </div>

            <div className="field full">
              <div className="label-row">
                <label>Customer</label>

                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    setCustomerMode(
                      customerMode === "existing"
                        ? "new"
                        : "existing",
                    )
                  }
                >
                  {customerMode === "existing"
                    ? "+ New customer"
                    : "Use existing customer"}
                </button>
              </div>

              {customerMode === "existing" ? (
  <div className="customer-picker">
    <div className="customer-search-control">
      <Search
        size={18}
        className="customer-search-icon"
        aria-hidden="true"
      />

      <input
        type="text"
        value={customerSearch}
        onChange={(event) =>
          setCustomerSearch(event.target.value)
        }
        placeholder="Search name, telephone or licence"
        aria-label="Search customers"
      />

      {customerSearch.length > 0 && (
        <button
          className="customer-search-clear"
          type="button"
          onClick={() =>
            setCustomerSearch("")
          }
          aria-label="Clear customer search"
        >
          <X size={15} />
        </button>
      )}
    </div>

    {selectedCustomer ? (
      <div className="selected-customer">
        <div className="selected-customer-icon">
          <UserRound size={19} />
        </div>

        <div>
          <strong>
            {selectedCustomer.fullName}
          </strong>

          <span>
            {selectedCustomer.telephone}
            {" · "}
            licence{" "}
            {selectedCustomer.licenceNumber}
          </span>
        </div>

        <button
          className="text-button"
          type="button"
          onClick={() =>
            setSelectedCustomerId("")
          }
        >
          Change
        </button>
      </div>
    ) : (
      <div className="customer-choice-list">
        {filteredCustomers
          .slice(0, 8)
          .map((customer) => (
            <button
              className="customer-choice"
              key={customer.id}
              type="button"
              onClick={() =>
                setSelectedCustomerId(
                  customer.id,
                )
              }
            >
              <span className="selected-customer-icon">
                <UserRound size={17} />
              </span>

              <span>
                <strong>
                  {customer.fullName}
                </strong>

                <small>
                  {customer.telephone}
                  {" · "}
                  licence{" "}
                  {customer.licenceNumber}
                </small>
              </span>

              <ChevronRight size={16} />
            </button>
          ))}

        {filteredCustomers.length === 0 && (
          <div className="customer-picker-empty">
            No matching customer. Use “+ New
            customer” to create one.
          </div>
        )}
      </div>
    )}
  </div>
) : (
              
                <div className="inline-customer-form">
                  <div className="field">
                    <label>Full name</label>
                    <input
                      name="newCustomerFullName"
                      autoComplete="name"
                    />
                  </div>

                  <div className="field">
                    <label>Telephone</label>
                    <input
                      name="newCustomerTelephone"
                      autoComplete="tel"
                      inputMode="tel"
                    />
                  </div>

                  <div className="field">
                    <label>Email</label>
                    <input
                      name="newCustomerEmail"
                      type="email"
                      autoComplete="email"
                    />
                  </div>

                  <div className="field">
                    <label>Licence number</label>
                    <input name="newCustomerLicence" />
                  </div>

                  <div className="field">
                    <label>Issuing country</label>
                    <input
                      name="newCustomerCountry"
                      minLength={2}
                      maxLength={2}
                      defaultValue="IN"
                    />
                  </div>

                  <div className="field">
                    <label>Licence expiry</label>
                    <input
                      name="newCustomerExpiry"
                      type="date"
                    />
                  </div>

                  <div className="field full">
                    <label>Address</label>
                    <input
                      name="newCustomerAddress"
                      autoComplete="street-address"
                    />
                  </div>

                  <div className="form-actions">
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const values = {
                          fullName: (
                            document.querySelector<HTMLInputElement>(
                              'input[name="newCustomerFullName"]',
                            )?.value || ""
                          ).trim(),

                          telephone: (
                            document.querySelector<HTMLInputElement>(
                              'input[name="newCustomerTelephone"]',
                            )?.value || ""
                          ).trim(),

                          email:
                            (
                              document.querySelector<HTMLInputElement>(
                                'input[name="newCustomerEmail"]',
                              )?.value || ""
                            ).trim() || null,

                          licenceNumber: (
                            document.querySelector<HTMLInputElement>(
                              'input[name="newCustomerLicence"]',
                            )?.value || ""
                          ).trim(),

                          licenceCountry: (
                            document.querySelector<HTMLInputElement>(
                              'input[name="newCustomerCountry"]',
                            )?.value || "IN"
                          )
                            .trim()
                            .toUpperCase(),

                          licenceExpiresAt:
                            document.querySelector<HTMLInputElement>(
                              'input[name="newCustomerExpiry"]',
                            )?.value || "",

                          address:
                            (
                              document.querySelector<HTMLInputElement>(
                                'input[name="newCustomerAddress"]',
                              )?.value || ""
                            ).trim() || null,
                        };

                        if (
                          !values.fullName ||
                          !values.telephone ||
                          !values.licenceNumber ||
                          values.licenceCountry.length !==
                            2 ||
                          !values.licenceExpiresAt
                        ) {
                          setError(
                            "Complete the required customer details before saving.",
                          );
                          return;
                        }

                        void run(async () => {
                          const result =
                            await callRentalFunction<
                              {
                                fullName: string;
                                telephone: string;
                                email: string | null;
                                address: string | null;
                                licenceNumber: string;
                                licenceCountry: string;
                                licenceExpiresAt: string;
                                dateOfBirth: string | null;
                                notes: string | null;
                                licenceStoragePath: string | null;
                              },
                              { customerId: string }
                            >(
                              "createOrUpdateCustomer",
                              {
                                ...values,
                                dateOfBirth: null,
                                notes: null,
                                licenceStoragePath:
                                  null,
                              },
                            );

                          setCustomerMode("existing");
                          setSelectedCustomerId(
                            result.customerId,
                          );
                          setCustomerSearch("");

                          return "Customer saved and selected for this booking.";
                        });
                      }}
                    >
                      <Plus size={16} />
                      Save and use customer
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="field">
              <label>Vehicle</label>

              <select
                name="vehicleId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Select vehicle
                </option>

                {vehicles.map((vehicle) => (
                  <option
                    value={vehicle.id}
                    key={vehicle.id}
                  >
                    {vehicle.registrationNumber}
                    {" · "}
                    {vehicle.make} {vehicle.model}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Pickup</label>

              <input
                name="pickupAt"
                type="datetime-local"
                min={todayDateTime()}
                required
              />
            </div>

            <div className="field">
              <label>Expected return</label>

              <input
                name="expectedReturnAt"
                type="datetime-local"
                min={todayDateTime()}
                required
              />
            </div>

            <div className="field full">
              <MediaCapture
                stage="booking"
                value={bookingMedia}
                onChange={setBookingMedia}
                label="Vehicle condition at booking"
                hint="Capture exterior and interior photos or video before confirming the booking."
              />
            </div>

            <div className="field full">
              <label>Booking note</label>
              <textarea name="notes" />
            </div>

            <div className="form-actions">
              <button
                className="button button-primary"
                disabled={
                  busy ||
                  !selectedCustomerId ||
                  !vehicles.length
                }
              >
                Confirm booking
              </button>
            </div>
          </form>
        )}

        {tab === "checkout" && (
          <form
            className="form-grid"
            onSubmit={checkout}
          >
            <div className="form-section">
              <p className="section-kicker">
                Checkout
              </p>

              <h2>Hand over vehicle</h2>

              <p>
                Select the booking. Customer and vehicle
                details are already attached to it.
              </p>
            </div>

            <div className="field full">
              <label>Confirmed booking</label>

              <select
                name="reservationId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Select confirmed booking
                </option>

                {reservations.map(
                  (reservation) => (
                    <option
                      value={reservation.id}
                      key={reservation.id}
                    >
                      {reservation.vehicleRegistration}
                      {" · "}
                      {reservation.customerName}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div className="field">
              <label>Pickup odometer (km)</label>

              <input
                name="pickupOdometerKm"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                required
              />
            </div>

            <div className="field">
              <label>Pickup fuel</label>

              <select name="pickupFuelLevel">
                {fuelLevels.map((level) => (
                  <option
                    key={level}
                    value={level}
                  >
                    {formatFuel(level)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field full">
              <label>Checkout note</label>
              <textarea name="notes" />
            </div>

            <div className="form-actions">
              <button
                className="button button-primary"
                disabled={
                  busy ||
                  !reservations.length
                }
              >
                Complete checkout
              </button>
            </div>
          </form>
        )}

        {tab === "extend" && (
          <form
            className="form-grid"
            onSubmit={extend}
          >
            <div className="form-section">
              <p className="section-kicker">
                Extension
              </p>

              <h2>Extend a rental</h2>

              <p>
                Select the rental. Customer and vehicle
                are already attached to it.
              </p>
            </div>

            <div className="field full">
              <label>Active rental</label>

              <select
                name="rentalId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Select active rental
                </option>

                {rentals.map((rental) => (
                  <option
                    value={rental.id}
                    key={rental.id}
                  >
                    {rental.vehicleRegistration}
                    {" · "}
                    {rental.customerName}
                    {rental.status ===
                    "overdue"
                      ? " · OVERDUE"
                      : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>
                New expected return
              </label>

              <input
                name="expectedReturnAt"
                type="datetime-local"
                min={todayDateTime()}
                required
              />
            </div>

            <div className="field">
              <label>Extension note</label>

              <input
                name="note"
                minLength={1}
                maxLength={500}
                required
              />
            </div>

            <div className="form-actions">
              <button
                className="button button-primary"
                disabled={
                  busy || !rentals.length
                }
              >
                Extend rental
              </button>
            </div>
          </form>
        )}

        {tab === "return" && (
          <form
            className="form-grid"
            onSubmit={completeReturn}
          >
            <div className="form-section">
              <p className="section-kicker">
                Return
              </p>

              <h2>Close a rental</h2>

              <p>
                Record the final condition and capture
                return evidence before closing the rental.
              </p>
            </div>

            <div className="field full">
              <label>Active rental</label>

              <select
                name="rentalId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Select active rental
                </option>

                {rentals.map((rental) => (
                  <option
                    value={rental.id}
                    key={rental.id}
                  >
                    {rental.vehicleRegistration}
                    {" · "}
                    {rental.customerName}
                    {rental.status ===
                    "overdue"
                      ? " · OVERDUE"
                      : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Return time</label>

              <input
                name="actualReturnAt"
                type="datetime-local"
                defaultValue={todayDateTime()}
                required
              />
            </div>

            <div className="field">
              <label>
                Return odometer (km)
              </label>

              <input
                name="returnOdometerKm"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                required
              />
            </div>

            <div className="field">
              <label>Return fuel</label>

              <select name="returnFuelLevel">
                {fuelLevels.map((level) => (
                  <option
                    key={level}
                    value={level}
                  >
                    {formatFuel(level)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Adjustment</label>

              <select name="adjustmentType">
                <option value="fuel">
                  Fuel charge
                </option>
                <option value="cleaning">
                  Cleaning fee
                </option>
                <option value="damage">
                  Damage charge
                </option>
                <option value="late_fee">
                  Late fee
                </option>
                <option value="discount">
                  Discount
                </option>
                <option value="other">
                  Other
                </option>
              </select>
            </div>

            <div className="field">
              <label>
                Amount (USD, optional)
              </label>

              <input
                name="adjustmentAmount"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
              />
            </div>

            <div className="field">
              <label>
                Adjustment note
              </label>

              <input
                name="adjustmentNote"
                maxLength={500}
              />
            </div>

            <div className="field full">
              <MediaCapture
                stage="return"
                value={returnMedia}
                onChange={setReturnMedia}
                label="Vehicle condition at return"
                hint="Capture final exterior/interior condition and any new damage."
              />
            </div>

            <div className="field full">
              <label>Return note</label>
              <textarea name="notes" />
            </div>

            <div className="form-actions">
              <button
                className="button button-primary"
                disabled={
                  busy || !rentals.length
                }
              >
                Complete return
              </button>
            </div>
          </form>
        )}

        {tab === "payment" && (
          <form
            className="form-grid"
            onSubmit={recordPayment}
          >
            <div className="form-section">
              <p className="section-kicker">
                Payment
              </p>

              <h2>Record payment</h2>

              <p>
                Select the rental. Customer and vehicle
                details are already attached.
              </p>
            </div>

            <div className="field full">
              <label>Rental</label>

              <select
                name="rentalId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Select active rental
                </option>

                {rentals.map((rental) => (
                  <option
                    value={rental.id}
                    key={rental.id}
                  >
                    {rental.vehicleRegistration}
                    {" · "}
                    {rental.customerName}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Amount (USD)</label>

              <input
                name="amount"
                type="number"
                min="0.01"
                max="100000"
                step="0.01"
                inputMode="decimal"
                required
              />
            </div>

            <div className="field">
              <label>Method</label>

              <select name="method">
                <option value="cash">
                  Cash
                </option>
                <option value="card">
                  Card
                </option>
                <option value="bank_transfer">
                  Bank transfer
                </option>
                <option value="other">
                  Other
                </option>
              </select>
            </div>

            <div className="field full">
              <label>Reference</label>
              <input
                name="reference"
                maxLength={200}
              />
            </div>

            <div className="form-actions">
              <button
                className="button button-primary"
                disabled={
                  busy || !rentals.length
                }
              >
                Record payment
              </button>
            </div>
          </form>
        )}
      </section>
    </AppShell>
  );
}