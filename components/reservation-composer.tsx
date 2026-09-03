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

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AppShell } from "./app-shell";
import { CountrySelect } from "./country-select";
import { CustomerLicenseCapture } from "./customer-license-capture";
import { MediaCapture } from "./media-capture";
import { CustomerSignaturePad } from "./customer-signature-pad";

import { getFirebaseClient } from "@/lib/firebase/client";

import {
  firebaseErrorMessage,
  formatFuel,
  formatMoney,
} from "@/lib/presentation";

import type { CloudinaryMedia } from "@/lib/cloudinary";

import {
  callFirestoreOperation,
} from "@/lib/services/firestore-client";

type Tab =
  | "booking"
  | "checkout"
  | "extend"
  | "return"
  | "payment";

type CustomerMode =
  | "existing"
  | "new";

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
  expectedReturnAt: string | null;
  createdByNameSnapshot: string | null;
  checkedOutByNameSnapshot: string | null;
  status: string;
};

type PayableRental = {
  id: string;
  customerName: string;
  vehicleRegistration: string;
  status: string;
  outstandingCents: number;
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
  "one_eighth",
  "quarter",
  "three_eighths",
  "half",
  "five_eighths",
  "three_quarters",
  "seven_eighths",
  "full",
] as const;

const paymentFeeOptions = [
  {
    type: "car_seat",
    label: "Car seat",
    selectedName: "fee_car_seat_selected",
    amountName: "fee_car_seat_amount",
  },
  {
    type: "insurance",
    label: "Insurance",
    selectedName: "fee_insurance_selected",
    amountName: "fee_insurance_amount",
  },
  {
    type: "cleaning",
    label: "Detailing / Cleaning",
    selectedName: "fee_cleaning_selected",
    amountName: "fee_cleaning_amount",
  },
  {
    type: "smoke_fee",
    label: "Smoke fee",
    selectedName: "fee_smoke_fee_selected",
    amountName: "fee_smoke_fee_amount",
  },
  {
    type: "refueling",
    label: "Refueling",
    selectedName: "fee_refueling_selected",
    amountName: "fee_refueling_amount",
  },
] as const;

function localToIso(
  value: FormDataEntryValue | null,
): string {
  const date = new Date(
    String(value),
  );

  if (
    Number.isNaN(
      date.valueOf(),
    )
  ) {
    throw new Error(
      "Enter a valid date and time.",
    );
  }

  return date.toISOString();
}

function formatVehicleStatus(
  status: string,
): string {
  return status
    .replaceAll("_", " ")
    .replace(
      /\b\w/g,
      (letter) =>
        letter.toUpperCase(),
    );
}

function todayDateTime(): string {
  const value =
    new Date();

  value.setMinutes(
    value.getMinutes() -
      value.getTimezoneOffset(),
  );

  return value
    .toISOString()
    .slice(0, 16);
}

function tomorrowDate(): string {
  const value =
    new Date();

  value.setDate(
    value.getDate() +
      1,
  );

  return value
    .toISOString()
    .slice(0, 10);
}

function toDateTimeInput(
  value: unknown,
): string | null {
  if (
    value &&
    typeof value ===
      "object" &&
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
      const date =
        timestamp.toDate();

      return Number.isNaN(
        date.valueOf(),
      )
        ? null
        : date.toISOString();
    }
  }

  if (value instanceof Date) {
    return Number.isNaN(
      value.valueOf(),
    )
      ? null
      : value.toISOString();
  }

  if (
    typeof value ===
    "string"
  ) {
    const date =
      new Date(value);

    return Number.isNaN(
      date.valueOf(),
    )
      ? null
      : date.toISOString();
  }

  return null;
}

export function ReservationComposer() {
  const [tab, setTab] =
    useState<Tab>("booking");

  const [customerMode, setCustomerMode] =
    useState<CustomerMode>(
      "existing",
    );

  const [customers, setCustomers] =
    useState<Customer[]>([]);

  const [selectedCustomerId, setSelectedCustomerId] =
    useState("");

  const [customerSearch, setCustomerSearch] =
    useState<string>("");

  const customerSearchInputRef =
    useRef<HTMLInputElement>(null);

  const [vehicles, setVehicles] =
    useState<Vehicle[]>([]);

  const [reservations, setReservations] =
    useState<Reservation[]>([]);

  const [rentals, setRentals] =
    useState<Rental[]>([]);

  const [payableRentals, setPayableRentals] =
    useState<PayableRental[]>([]);

  const [bookingMedia, setBookingMedia] =
    useState<CloudinaryMedia[]>([]);

  const [returnMedia, setReturnMedia] =
    useState<CloudinaryMedia[]>([]);

  const [customerSignature, setCustomerSignature] =
    useState<string | null>(null);

  /*
   * New-customer licence capture state.
   * The customer must exist first because the
   * licence is stored under that customer ID.
   */
  const [newCustomerId, setNewCustomerId] =
    useState<string | null>(null);

  const [newCustomerLicencePath, setNewCustomerLicencePath] =
    useState<string | null>(null);

  const [error, setError] =
    useState<string>();

  const [notice, setNotice] =
    useState<string>();

  const [busy, setBusy] =
    useState(false);

  const selectedCustomer =
    customers.find(
      (customer) =>
        customer.id ===
        selectedCustomerId,
    );

  useEffect(() => {
    if (
      customerSearchInputRef.current &&
      customerSearchInputRef.current.value !==
        customerSearch
    ) {
      customerSearchInputRef.current.value =
        customerSearch;
    }
  }, [
    customerSearch,
  ]);

  const filteredCustomers =
    useMemo(() => {
      const needle =
        String(
          customerSearch ?? "",
        )
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
          ]
            .filter(Boolean)
            .some((value) =>
              String(value)
                .toLowerCase()
                .includes(
                  needle,
                ),
            ),
      );
    }, [
      customerSearch,
      customers,
    ]);

  /*
   * ---------------------------------------------------------
   * LOAD BOOKING DATA
   * ---------------------------------------------------------
   *
   * Vehicles are filtered in Firestore by status only.
   * We intentionally do NOT combine status filtering
   * with an orderBy that would require an unnecessary
   * composite Firestore index.
   *
   * Vehicles are sorted locally after retrieval.
   */
  async function load() {
    try {
      setError(undefined);

      const db =
        getFirebaseClient().db;

      const [
        customerDocs,
        vehicleDocs,
        reservationDocs,
        rentalDocs,
      ] = await Promise.all([
        getDocs(
          query(
            collection(
              db,
              "customers",
            ),
            orderBy(
              "fullName",
            ),
            limit(500),
          ),
        ),

        getDocs(
          query(
            collection(
              db,
              "vehicles",
            ),
            limit(100),
          ),
        ),

        getDocs(
          query(
            collection(
              db,
              "reservations",
            ),
            where(
              "status",
              "==",
              "confirmed",
            ),
            limit(50),
          ),
        ),

        getDocs(
          query(
            collection(
              db,
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
            limit(50),
          ),
        ),
      ]);

      setCustomers(
        customerDocs.docs.map(
          (snapshot) => ({
            id: snapshot.id,
            fullName:
              snapshot.get(
                "fullName",
              ),
            telephone:
              snapshot.get(
                "telephone",
              ),
            email:
              snapshot.get(
                "email",
              ) ?? null,
            licenceNumber:
              snapshot.get(
                "licenceNumber",
              ),
            licenceCountry:
              snapshot.get(
                "licenceCountry",
              ),
            licenceExpiresAt:
              snapshot.get(
                "licenceExpiresAt",
              ) ?? null,
          }),
        ),
      );

      setVehicles(
        vehicleDocs.docs
          .map(
            (snapshot) => ({
              id: snapshot.id,
              registrationNumber:
                snapshot.get(
                  "registrationNumber",
                ),
              make:
                snapshot.get(
                  "make",
                ),
              model:
                snapshot.get(
                  "model",
                ),
              status:
                snapshot.get(
                  "status",
                ),
            }),
          )
          .sort(
            (a, b) =>
              a.registrationNumber.localeCompare(
                b.registrationNumber,
              ),
          ),
      );

      setReservations(
        reservationDocs.docs.map(
          (snapshot) => ({
            id: snapshot.id,
            customerName:
              snapshot.get(
                "customerNameSnapshot",
              ),
            vehicleRegistration:
              snapshot.get(
                "vehicleRegistrationSnapshot",
              ),
          }),
        ),
      );

      setRentals(
        rentalDocs.docs.map(
          (snapshot) => ({
            id: snapshot.id,
            customerName:
              snapshot.get(
                "customerNameSnapshot",
              ),
            vehicleRegistration:
              snapshot.get(
                "vehicleRegistrationSnapshot",
              ),
            pickupOdometerKm:
              Number(
                snapshot.get(
                  "pickupOdometerKm",
                ) ?? 0,
              ),
            expectedReturnAt:
              toDateTimeInput(
                snapshot.get(
                  "expectedReturnAt",
                ),
              ),
            createdByNameSnapshot:
              snapshot.get(
                "createdByNameSnapshot",
              ) ??
              null,
            checkedOutByNameSnapshot:
              snapshot.get(
                "checkedOutByNameSnapshot",
              ) ??
              null,
            status:
              snapshot.get(
                "status",
              ),
          }),
        ),
      );
    } catch (cause) {
      console.error(
        "[ReservationComposer] load failed:",
        cause,
      );

      setError(
        firebaseErrorMessage(
          cause,
        ),
      );
    }
  }

  async function loadPayableRentals() {
    try {
      const records =
        await callFirestoreOperation<
          Record<string, never>,
          PayableRental[]
        >(
          "getPayableRentals",
          {},
        );

      setPayableRentals(
        records,
      );
    } catch (cause) {
      console.error(
        "[ReservationComposer] loadPayableRentals failed:",
        cause,
      );

      setError(
        firebaseErrorMessage(
          cause,
        ),
      );
    }
  }

  useEffect(() => {
    const timer =
      window.setTimeout(
        () => {
          void load();
          void loadPayableRentals();
        },
        0,
      );

    return () =>
      window.clearTimeout(
        timer,
      );
  }, []);

  useEffect(() => {
    if (
      tab !==
      "payment"
    ) {
      return;
    }

    void loadPayableRentals();
  }, [tab]);

  async function run(
    task: () => Promise<string>,
  ) {
    setError(undefined);
    setNotice(undefined);
    setBusy(true);

    try {
      setNotice(
        await task(),
      );

      await load();
      await loadPayableRentals();
    } catch (cause) {
      setError(
        firebaseErrorMessage(
          cause,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * New customer licence upload handler.
   *
   * CustomerLicenseCapture uploads the actual image
   * to Storage and gives us the resulting storage path.
   * We then persist that path against the newly-created
   * customer document through the existing backend operation.
   */
  async function handleNewCustomerLicenceChange(
    storagePath: string | null,
  ) {
    if (!newCustomerId) {
      return;
    }

    setNewCustomerLicencePath(
      storagePath,
    );

    if (!storagePath) {
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
            newCustomerId,
          licenceStoragePath:
            storagePath,
        },
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

  function createReservation(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !selectedCustomerId
    ) {
      setError(
        "Select an existing customer or create a new customer before booking.",
      );

      return;
    }

    const formElement =
      event.currentTarget;

    const form =
      new FormData(
        formElement,
      );

    void run(
      async () => {
        const result =
          await callFirestoreOperation<
            {
              customerId: string;
              vehicleId: string;
              pickupAt: string;
              expectedReturnAt: string;
              pickupLocation:
                | string
                | null;
              dropoffLocation:
                | string
                | null;
              notes:
                | string
                | null;
              bookingMedia: CloudinaryMedia[];
              customerSignatureDataUrl: string;
            },
            {
              reservationId: string;
              quote: {
                baseRentalCents: number;
                chargedDays: number;
              };
            }
          >(
            "createReservation",
            {
              customerId:
                selectedCustomerId,

              vehicleId:
                String(
                  form.get(
                    "vehicleId",
                  ),
                ),

              pickupAt:
                localToIso(
                  form.get(
                    "pickupAt",
                  ),
                ),

              expectedReturnAt:
                localToIso(
                  form.get(
                    "expectedReturnAt",
                  ),
                ),

              pickupLocation:
                String(
                  form.get(
                    "pickupLocation",
                  ),
                ).trim() ||
                null,

              dropoffLocation:
                String(
                  form.get(
                    "dropoffLocation",
                  ),
                ).trim() ||
                null,

              notes:
                String(
                  form.get(
                    "notes",
                  ),
                ).trim() ||
                null,

              bookingMedia,

              customerSignatureDataUrl:
                customerSignature ||
                "",
            },
          );

        let contractStatus = "";

        if (
          selectedCustomer?.email
        ) {
          try {
            await callFirestoreOperation<
              {
                reservationId: string;
              },
              {
                emailId: string;
              }
            >(
              "sendReservationContract",
              {
                reservationId:
                  result.reservationId,
              },
            );

            contractStatus = ` Rental agreement emailed to ${selectedCustomer.email}.`;
          } catch (emailError) {
            console.error(
              "Rental agreement email failed:",
              emailError,
            );

            contractStatus = ` Booking was created, but the rental agreement could not be emailed: ${firebaseErrorMessage(
              emailError,
            )}`;
          }
        } else {
          contractStatus =
            " Booking was created, but no customer email is available for the rental agreement.";
        }

        formElement.reset();

        setSelectedCustomerId(
          "",
        );

        setBookingMedia(
          [],
        );

        setCustomerSignature(
          null,
        );

        setCustomerSearch(
          "",
        );

        setCustomerMode(
          "existing",
        );

        setNewCustomerId(
          null,
        );

        setNewCustomerLicencePath(
          null,
        );

        return `Booking confirmed · ${result.quote.chargedDays} day(s) · ${formatMoney(
          result.quote.baseRentalCents,
        )}.${contractStatus}`;
      },
    );
  }

  function checkout(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const formElement =
      event.currentTarget;

    const form =
      new FormData(
        formElement,
      );

    void run(
      async () => {
        const result =
          await callFirestoreOperation<
            {
              reservationId: string;
              pickupFuelLevel: string;
              pickupOdometer: {
                value: number;
                unit:
                  | "km"
                  | "mi";
              };
              notes:
                | string
                | null;
            },
            {
              rentalId: string;
            }
          >(
            "checkoutReservation",
            {
              reservationId:
                String(
                  form.get(
                    "reservationId",
                  ),
                ),

              pickupFuelLevel:
                String(
                  form.get(
                    "pickupFuelLevel",
                  ),
                ),

              pickupOdometer: {
                value: Number(
                  form.get(
                    "pickupOdometerValue",
                  ),
                ),
                unit:
                  String(
                    form.get(
                      "pickupOdometerUnit",
                    ),
                  ) as
                    | "km"
                    | "mi",
              },

              notes:
                String(
                  form.get(
                    "notes",
                  ),
                ).trim() ||
                null,
            },
          );

        formElement.reset();

        return `Vehicle checked out · rental ${result.rentalId}.`;
      },
    );
  }

  function extend(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const formElement =
      event.currentTarget;

    const form =
      new FormData(
        formElement,
      );

    void run(
      async () => {
        const result =
          await callFirestoreOperation<
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
          >(
            "extendRental",
            {
              rentalId:
                String(
                  form.get(
                    "rentalId",
                  ),
                ),

              expectedReturnAt:
                localToIso(
                  form.get(
                    "expectedReturnAt",
                  ),
                ),

              note:
                String(
                  form.get(
                    "note",
                  ),
                ).trim(),

              idempotencyKey:
                crypto.randomUUID(),
            },
          );

        formElement.reset();

        return `Rental extended · ${formatMoney(
          result.extensionCents,
        )} added · balance ${formatMoney(
          result.outstandingCents,
        )}.`;
      },
    );
  }

  function completeReturn(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const formElement =
      event.currentTarget;

    const form =
      new FormData(
        formElement,
      );

    void run(
      async () => {
        const amount =
          String(
            form.get(
              "adjustmentAmount",
            ),
          );

        const adjustments =
          amount
            ? [
                {
                  type:
                    String(
                      form.get(
                        "adjustmentType",
                      ),
                    ),

                  amountCents:
                    Math.round(
                      Number(
                        amount,
                      ) * 100,
                    ),

                  note:
                    String(
                      form.get(
                        "adjustmentNote",
                      ),
                    ).trim() ||
                    "Return adjustment",
                },
              ]
            : [];

        const result =
          await callFirestoreOperation<
            {
              rentalId: string;
              actualReturnAt: string;
              returnFuelLevel: string;
              returnOdometer: {
                value: number;
                unit:
                  | "km"
                  | "mi";
              };
              adjustments: Array<{
                type: string;
                amountCents: number;
                note: string;
              }>;
              notes:
                | string
                | null;
              returnMedia: CloudinaryMedia[];
            },
            {
              outstandingCents: number;
            }
          >(
            "returnRental",
            {
              rentalId:
                String(
                  form.get(
                    "rentalId",
                  ),
                ),

              actualReturnAt:
                localToIso(
                  form.get(
                    "actualReturnAt",
                  ),
                ),

              returnFuelLevel:
                String(
                  form.get(
                    "returnFuelLevel",
                  ),
                ),

              returnOdometer: {
                value: Number(
                  form.get(
                    "returnOdometerValue",
                  ),
                ),
                unit:
                  String(
                    form.get(
                      "returnOdometerUnit",
                    ),
                  ) as
                    | "km"
                    | "mi",
              },

              adjustments,

              notes:
                String(
                  form.get(
                    "notes",
                  ),
                ).trim() ||
                null,

              returnMedia,
            },
          );

        formElement.reset();

        setReturnMedia(
          [],
        );

        return `Return completed · outstanding balance ${formatMoney(
          result.outstandingCents,
        )}.`;
      },
    );
  }

  function recordPayment(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const formElement =
      event.currentTarget;

    const form =
      new FormData(
        formElement,
      );

    void run(
      async () => {
        const additionalFees =
          paymentFeeOptions
            .map((fee) => {
              const selected =
                form.get(
                  fee.selectedName,
                ) === "on";

              if (!selected) {
                return null;
              }

              const rawAmount =
                String(
                  form.get(
                    fee.amountName,
                  ) ??
                    "",
                ).trim();

              if (!rawAmount) {
                throw new Error(
                  `${fee.label} was selected but no amount was entered.`,
                );
              }

              const amountCents =
                Math.round(
                  Number(
                    rawAmount,
                  ) * 100,
                );

              if (
                !Number.isFinite(
                  amountCents,
                ) ||
                amountCents <=
                  0
              ) {
                throw new Error(
                  `${fee.label} amount must be greater than zero.`,
                );
              }

              return {
                type: fee.type,
                amountCents,
              };
            })
            .filter(
              (
                fee,
              ): fee is {
                type: (
                  typeof paymentFeeOptions
                )[number]["type"];
                amountCents: number;
              } =>
                fee !== null,
            );

        const result =
          await callFirestoreOperation<
            {
              rentalId: string;
              amountCents: number;
              method: string;
              externalReference:
                | string
                | null;
              additionalFees: Array<{
                type:
                  | "car_seat"
                  | "insurance"
                  | "cleaning"
                  | "smoke_fee"
                  | "refueling";
                amountCents: number;
              }>;
              idempotencyKey: string;
            },
            {
              outstandingCents: number;
            }
          >(
            "recordRentalPayment",
            {
              rentalId:
                String(
                  form.get(
                    "rentalId",
                  ),
                ),

              amountCents:
                Math.round(
                  Number(
                    form.get(
                      "amount",
                    ),
                  ) * 100,
                ),

              method:
                String(
                  form.get(
                    "method",
                  ),
                ),

              externalReference:
                String(
                  form.get(
                    "reference",
                  ),
                ).trim() ||
                null,

              additionalFees,

              idempotencyKey:
                crypto.randomUUID(),
            },
          );

        formElement.reset();

        return `Payment recorded · outstanding balance ${formatMoney(
          result.outstandingCents,
        )}.`;
      },
    );
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
          ({
            id,
            label,
            icon: Icon,
          }) => (
            <button
              key={id}
              className={
                tab === id
                  ? "active"
                  : ""
              }
              type="button"
              onClick={() =>
                setTab(id)
              }
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
        {tab ===
          "booking" && (
          <form
            className="form-grid"
            onSubmit={
              createReservation
            }
          >
            <div className="form-section">
              <p className="section-kicker">
                New booking
              </p>

              <h2>
                Book a vehicle
              </h2>

              <p>
                Select the customer once,
                select the vehicle once,
                capture the vehicle
                condition and confirm the
                reservation.
              </p>
            </div>

            <div className="field full">
              <div className="label-row">
                <label>
                  Customer
                </label>

                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    const nextMode =
                      customerMode ===
                      "existing"
                        ? "new"
                        : "existing";

                    setCustomerMode(
                      nextMode,
                    );

                    if (
                      nextMode ===
                      "existing"
                    ) {
                      setNewCustomerId(
                        null,
                      );

                      setNewCustomerLicencePath(
                        null,
                      );
                    }

                    setError(
                      undefined,
                    );

                    setNotice(
                      undefined,
                    );
                  }}
                >
                  {customerMode ===
                  "existing"
                    ? "+ New customer"
                    : "Use existing customer"}
                </button>
              </div>

              {customerMode ===
              "existing" ? (
                <div className="customer-picker">
                  <div className="customer-search-control">
                    <Search
                      size={18}
                      className="customer-search-icon"
                      aria-hidden="true"
                    />

                    <input
                      ref={
                        customerSearchInputRef
                      }
                      type="text"
                      defaultValue=""
                      onChange={(
                        event,
                      ) =>
                        setCustomerSearch(
                          event
                            .target
                            .value,
                        )
                      }
                      placeholder="Search name, telephone or licence"
                      aria-label="Search customers"
                    />

                    {customerSearch.length >
                      0 && (
                      <button
                        className="customer-search-clear"
                        type="button"
                        onClick={() =>
                          setCustomerSearch(
                            "",
                          )
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
                        <UserRound
                          size={19}
                        />
                      </div>

                      <div>
                        <strong>
                          {
                            selectedCustomer.fullName
                          }
                        </strong>

                        <span>
                          {
                            selectedCustomer.telephone
                          }
                          {" · "}
                          licence{" "}
                          {
                            selectedCustomer.licenceNumber
                          }
                        </span>
                      </div>

                      <button
                        className="text-button"
                        type="button"
                        onClick={() =>
                          setSelectedCustomerId(
                            "",
                          )
                        }
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="customer-choice-list">
                      {filteredCustomers
                        .slice(
                          0,
                          8,
                        )
                        .map(
                          (
                            customer,
                          ) => (
                            <button
                              className="customer-choice"
                              key={
                                customer.id
                              }
                              type="button"
                              onClick={() =>
                                setSelectedCustomerId(
                                  customer.id,
                                )
                              }
                            >
                              <span className="selected-customer-icon">
                                <UserRound
                                  size={
                                    17
                                  }
                                />
                              </span>

                              <span>
                                <strong>
                                  {
                                    customer.fullName
                                  }
                                </strong>

                                <small>
                                  {
                                    customer.telephone
                                  }
                                  {" · "}
                                  licence{" "}
                                  {
                                    customer.licenceNumber
                                  }
                                </small>
                              </span>

                              <ChevronRight
                                size={16}
                              />
                            </button>
                          ),
                        )}

                      {filteredCustomers.length ===
                        0 && (
                        <div className="customer-picker-empty">
                          No matching
                          customer. Use “+ New
                          customer” to create
                          one.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="inline-customer-form">
                  <div className="field">
                    <label>
                      Full name
                    </label>

                    <input
                      name="newCustomerFullName"
                      autoComplete="name"
                    />
                  </div>

                  <div className="field">
                    <label>
                      Telephone
                    </label>

                    <input
                      name="newCustomerTelephone"
                      autoComplete="tel"
                      inputMode="tel"
                    />
                  </div>

                  <div className="field">
                    <label>
                      Email
                    </label>

                    <input
                      name="newCustomerEmail"
                      type="email"
                      autoComplete="email"
                    />
                  </div>

                  <div className="field">
                    <label>
                      Licence number
                    </label>

                    <input
                      name="newCustomerLicence"
                    />
                  </div>

                  <div className="field">
                    <label>
                      Issuing country
                    </label>

                    <CountrySelect
                      name="newCustomerCountry"
                      required
                    />
                  </div>

                  <div className="field">
                    <label>
                      Licence expiry
                    </label>

                    <input
                      name="newCustomerExpiry"
                      type="date"
                      min={tomorrowDate()}
                      required
                    />
                  </div>

                  <div className="field full">
                    <label>
                      Address
                    </label>

                    <input
                      name="newCustomerAddress"
                      autoComplete="street-address"
                    />
                  </div>

                  {newCustomerId ? (
                    <div className="field full">
                      <CustomerLicenseCapture
                        customerId={
                          newCustomerId
                        }
                        value={
                          newCustomerLicencePath
                        }
                        onChange={
                          handleNewCustomerLicenceChange
                        }
                      />

                      {!newCustomerLicencePath && (
                        <p className="form-help">
                          Capture the driver's
                          licence photo before this
                          customer can be used on a
                          booking.
                        </p>
                      )}

                      <div className="form-actions">
                        <button
                          className="button button-primary"
                          type="button"
                          disabled={
                            busy ||
                            !newCustomerLicencePath
                          }
                          onClick={() => {
                            if (
                              !newCustomerId ||
                              !newCustomerLicencePath
                            ) {
                              return;
                            }

                            setCustomerMode(
                              "existing",
                            );

                            setSelectedCustomerId(
                              newCustomerId,
                            );

                            setCustomerSearch(
                              "",
                            );

                            setNewCustomerId(
                              null,
                            );

                            setNewCustomerLicencePath(
                              null,
                            );
                          }}
                        >
                          Use customer
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="form-actions">
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const values =
                            {
                              fullName:
                                (
                                  document.querySelector<HTMLInputElement>(
                                    'input[name="newCustomerFullName"]',
                                  )?.value ||
                                  ""
                                ).trim(),

                              telephone:
                                (
                                  document.querySelector<HTMLInputElement>(
                                    'input[name="newCustomerTelephone"]',
                                  )?.value ||
                                  ""
                                ).trim(),

                              email:
                                (
                                  document.querySelector<HTMLInputElement>(
                                    'input[name="newCustomerEmail"]',
                                  )?.value ||
                                  ""
                                ).trim() ||
                                null,

                              licenceNumber:
                                (
                                  document.querySelector<HTMLInputElement>(
                                    'input[name="newCustomerLicence"]',
                                  )?.value ||
                                  ""
                                ).trim(),

                              licenceCountry:
                                (
                                  document.querySelector<HTMLSelectElement>(
                                    'select[name="newCustomerCountry"]',
                                  )?.value ||
                                  ""
                                )
                                  .trim()
                                  .toUpperCase(),

                              licenceExpiresAt:
                                document.querySelector<HTMLInputElement>(
                                  'input[name="newCustomerExpiry"]',
                                )?.value ||
                                "",

                              address:
                                (
                                  document.querySelector<HTMLInputElement>(
                                    'input[name="newCustomerAddress"]',
                                  )?.value ||
                                  ""
                                ).trim() ||
                                null,
                            };

                          if (
                            !values.fullName ||
                            !values.telephone ||
                            !values.licenceNumber ||
                            values
                              .licenceCountry
                              .length !==
                              2 ||
                            !values.licenceExpiresAt
                          ) {
                            setError(
                              "Complete the required customer details before saving.",
                            );

                            return;
                          }

                          const today =
                            new Date();

                          today.setHours(
                            0,
                            0,
                            0,
                            0,
                          );

                          const licenceExpiry =
                            new Date(
                              `${values.licenceExpiresAt}T00:00:00`,
                            );

                          licenceExpiry.setHours(
                            0,
                            0,
                            0,
                            0,
                          );

                          if (
                            Number.isNaN(
                              licenceExpiry.getTime(),
                            ) ||
                            licenceExpiry.getTime() <=
                              today.getTime()
                          ) {
                            setError(
                              "Licence expiry must be after today.",
                            );

                            return;
                          }

                          void run(
                            async () => {
                              const result =
                                await callFirestoreOperation<
                                  {
                                    fullName: string;
                                    telephone: string;
                                    email:
                                      | string
                                      | null;
                                    address:
                                      | string
                                      | null;
                                    licenceNumber: string;
                                    licenceCountry: string;
                                    licenceExpiresAt: string;
                                    dateOfBirth:
                                      | string
                                      | null;
                                    notes:
                                      | string
                                      | null;
                                    licenceStoragePath:
                                      | string
                                      | null;
                                  },
                                  {
                                    customerId: string;
                                  }
                                >(
                                  "createOrUpdateCustomer",
                                  {
                                    ...values,
                                    dateOfBirth:
                                      null,
                                    notes:
                                      null,
                                    licenceStoragePath:
                                      null,
                                  },
                                );

                              setNewCustomerId(
                                result.customerId,
                              );

                              setNewCustomerLicencePath(
                                null,
                              );

                              return "Customer saved. Capture the driver's licence.";
                            },
                          );
                        }}
                      >
                        <Plus
                          size={16}
                        />
                        Save customer
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="field">
              <label>
                Vehicle
              </label>

              <select
                name="vehicleId"
                required
                defaultValue=""
              >
                <option
                  value=""
                  disabled
                >
                  Select vehicle
                </option>

                {vehicles.map(
                  (vehicle) => {
                    const isBookable =
                      vehicle.status ===
                      "available";

                    return (
                      <option
                        value={
                          vehicle.id
                        }
                        key={
                          vehicle.id
                        }
                        disabled={
                          !isBookable
                        }
                      >
                        {
                          vehicle.registrationNumber
                        }
                        {" · "}
                        {
                          vehicle.make
                        }{" "}
                        {
                          vehicle.model
                        }
                        {!isBookable
                          ? ` · ${formatVehicleStatus(
                              vehicle.status,
                            )}`
                          : ""}
                      </option>
                    );
                  },
                )}
              </select>

              {vehicles.length >
                0 &&
                !vehicles.some(
                  (vehicle) =>
                    vehicle.status ===
                    "available",
                ) && (
                  <p className="form-help">
                    No vehicles are
                    currently available.
                  </p>
                )}
            </div>

            <div className="field">
              <label>
                Pickup
              </label>

              <input
                name="pickupAt"
                type="datetime-local"
                min={todayDateTime()}
                required
              />
            </div>

            <div className="field">
              <label>
                Expected return
              </label>

              <input
                name="expectedReturnAt"
                type="datetime-local"
                min={todayDateTime()}
                required
              />
            </div>

            <div className="field">
              <label>
                Pickup location
              </label>

              <input
                name="pickupLocation"
                type="text"
                maxLength={300}
                placeholder="e.g. Downtown office"
              />
            </div>

            <div className="field">
              <label>
                Drop-off location
              </label>

              <input
                name="dropoffLocation"
                type="text"
                maxLength={300}
                placeholder="e.g. Airport terminal"
              />
            </div>

            <div className="field full">
              <MediaCapture
                stage="booking"
                value={
                  bookingMedia
                }
                onChange={
                  setBookingMedia
                }
                label="Vehicle condition at booking"
                hint="Capture exterior and interior photos before confirming the booking."
              />
            </div>

            <div className="field full">
              <CustomerSignaturePad
                value={
                  customerSignature
                }
                onChange={
                  setCustomerSignature
                }
                disabled={busy}
              />
            </div>

            <div className="field full">
              {selectedCustomer?.email ? (
                <p className="form-help">
                  The rental agreement will be
                  emailed automatically to{" "}
                  {selectedCustomer.email} after
                  the booking is confirmed.
                </p>
              ) : (
                <p className="form-help">
                  No customer email is available.
                  The booking can still be
                  confirmed, but the rental
                  agreement cannot be emailed.
                </p>
              )}
            </div>

            <div className="field full">
              <label>
                Booking note
              </label>

              <textarea
                name="notes"
              />
            </div>

            <div className="form-actions">
              <button
                className="button button-primary"
                disabled={
                  busy ||
                  !selectedCustomerId ||
                  !customerSignature ||
                  !vehicles.some(
                    (vehicle) =>
                      vehicle.status ===
                      "available",
                  )
                }
              >
                Confirm booking
              </button>
            </div>
          </form>
        )}

        {tab ===
          "checkout" && (
          <form
            className="form-grid"
            onSubmit={
              checkout
            }
          >
            <div className="form-section">
              <p className="section-kicker">
                Checkout
              </p>

              <h2>
                Hand over vehicle
              </h2>

              <p>
                Select the booking.
                Customer and vehicle
                details are already
                attached to it.
              </p>
            </div>

            <div className="field full">
              <label>
                Confirmed booking
              </label>

              <select
                name="reservationId"
                required
                defaultValue=""
              >
                <option
                  value=""
                  disabled
                >
                  Select confirmed booking
                </option>

                {reservations.map(
                  (
                    reservation,
                  ) => (
                    <option
                      value={
                        reservation.id
                      }
                      key={
                        reservation.id
                      }
                    >
                      {
                        reservation.vehicleRegistration
                      }
                      {" · "}
                      {
                        reservation.customerName
                      }
                    </option>
                  ),
                )}
              </select>
            </div>

            <div className="field">
              <label>
                Pickup odometer
              </label>

              <div
                style={{
                  display:
                    "grid",
                  gridTemplateColumns:
                    "1fr auto",
                  gap: 12,
                }}
              >
                <input
                  name="pickupOdometerValue"
                  type="number"
                  min="0"
                  step="0.1"
                  inputMode="decimal"
                  required
                />

                <select
                  name="pickupOdometerUnit"
                  defaultValue="km"
                  aria-label="Pickup odometer unit"
                >
                  <option value="km">
                    Kilometers
                  </option>

                  <option value="mi">
                    Miles
                  </option>
                </select>
              </div>
            </div>

            <div className="field">
              <label>
                Pickup fuel
              </label>

              <select
                name="pickupFuelLevel"
              >
                {fuelLevels.map(
                  (level) => (
                    <option
                      key={
                        level
                      }
                      value={
                        level
                      }
                    >
                      {
                        formatFuel(
                          level,
                        )
                      }
                    </option>
                  ),
                )}
              </select>
            </div>

            <div className="field full">
              <label>
                Checkout note
              </label>

              <textarea
                name="notes"
              />
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

        {tab ===
          "extend" && (
          <form
            className="form-grid"
            onSubmit={
              extend
            }
          >
            <div className="form-section">
              <p className="section-kicker">
                Extension
              </p>

              <h2>
                Extend a rental
              </h2>

              <p>
                Select the rental.
                Customer and vehicle
                are already attached
                to it.
              </p>
            </div>

            <div className="field full">
              <label>
                Active rental
              </label>

              <select
                name="rentalId"
                required
                defaultValue=""
              >
                <option
                  value=""
                  disabled
                >
                  Select active rental
                </option>

                {rentals.map(
                  (rental) => (
                    <option
                      value={
                        rental.id
                      }
                      key={
                        rental.id
                      }
                    >
                      {
                        rental.vehicleRegistration
                      }
                      {" · "}
                      {
                        rental.customerName
                      }
                      {rental.status ===
                      "overdue"
                        ? " · OVERDUE"
                        : ""}
                    </option>
                  ),
                )}
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
              <label>
                Extension note
              </label>

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
                  busy ||
                  !rentals.length
                }
              >
                Extend rental
              </button>
            </div>
          </form>
        )}

        {tab ===
          "return" && (
          <form
            className="form-grid"
            onSubmit={
              completeReturn
            }
          >
            <div className="form-section">
              <p className="section-kicker">
                Return
              </p>

              <h2>
                Close a rental
              </h2>

              <p>
                Record the final
                condition and capture
                return evidence before
                closing the rental.
              </p>
            </div>

            <div className="field full">
              <label>
                Active rental
              </label>

              <select
                name="rentalId"
                required
                defaultValue=""
              >
                <option
                  value=""
                  disabled
                >
                  Select active rental
                </option>

                {rentals.map(
                  (rental) => (
                    <option
                      value={
                        rental.id
                      }
                      key={
                        rental.id
                      }
                    >
                      {
                        rental.vehicleRegistration
                      }
                      {" · "}
                      {
                        rental.customerName
                      }
                      {rental.status ===
                      "overdue"
                        ? " · OVERDUE"
                        : ""}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div className="field">
              <label>
                Return time
              </label>

              <input
                name="actualReturnAt"
                type="datetime-local"
                defaultValue={todayDateTime()}
                required
              />
            </div>

            <div className="field">
              <label>
                Return odometer
              </label>

              <div
                style={{
                  display:
                    "grid",
                  gridTemplateColumns:
                    "1fr auto",
                  gap: 12,
                }}
              >
                <input
                  name="returnOdometerValue"
                  type="number"
                  min="0"
                  step="0.1"
                  inputMode="decimal"
                  required
                />

                <select
                  name="returnOdometerUnit"
                  defaultValue="km"
                  aria-label="Return odometer unit"
                >
                  <option value="km">
                    Kilometers
                  </option>

                  <option value="mi">
                    Miles
                  </option>
                </select>
              </div>
            </div>

            <div className="field">
              <label>
                Return fuel
              </label>

              <select
                name="returnFuelLevel"
              >
                {fuelLevels.map(
                  (level) => (
                    <option
                      key={
                        level
                      }
                      value={
                        level
                      }
                    >
                      {
                        formatFuel(
                          level,
                        )
                      }
                    </option>
                  ),
                )}
              </select>
            </div>

            <div className="field">
              <label>
                Adjustment
              </label>

              <select
                name="adjustmentType"
              >
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
                value={
                  returnMedia
                }
                onChange={
                  setReturnMedia
                }
                label="Vehicle condition at return"
                hint="Capture final exterior/interior condition and any new damage."
              />
            </div>

            <div className="field full">
              <label>
                Return note
              </label>

              <textarea
                name="notes"
              />
            </div>

            <div className="form-actions">
              <button
                className="button button-primary"
                disabled={
                  busy ||
                  !rentals.length
                }
              >
                Complete return
              </button>
            </div>
          </form>
        )}

        {tab ===
          "payment" && (
          <form
            className="form-grid"
            onSubmit={
              recordPayment
            }
          >
            <div className="form-section">
              <p className="section-kicker">
                Payment
              </p>

              <h2>
                Record payment
              </h2>

              <p>
                Select the rental.
                Customer and vehicle
                details are already
                attached.
              </p>
            </div>

            <div className="field full">
              <label>
                Rental
              </label>

              <select
                name="rentalId"
                required
                defaultValue=""
              >
                <option
                  value=""
                  disabled
                >
                  Select rental with balance
                </option>

                {payableRentals.map(
                  (rental) => (
                    <option
                      value={
                        rental.id
                      }
                      key={
                        rental.id
                      }
                    >
                      {
                        rental.vehicleRegistration
                      }
                      {" · "}
                      {
                        rental.customerName
                      }
                      {" · "}
                      {formatMoney(
                        rental.outstandingCents,
                      )}{" "}
                      due
                    </option>
                  ),
                )}
              </select>
            </div>

            <div className="field">
              <label>
                Amount (USD)
              </label>

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
              <label>
                Method
              </label>

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
              <label>
                Additional fees
              </label>

              <div
                className="form-grid"
                style={{
                  marginTop: 8,
                }}
              >
                {paymentFeeOptions.map(
                  (fee) => (
                    <div
                      className="field"
                      key={
                        fee.type
                      }
                    >
                      <label>
                        <input
                          name={
                            fee.selectedName
                          }
                          type="checkbox"
                        />{" "}
                        {
                          fee.label
                        }
                      </label>

                      <input
                        name={
                          fee.amountName
                        }
                        type="number"
                        min="0.01"
                        max="100000"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="Amount (USD)"
                      />
                    </div>
                  ),
                )}
              </div>
            </div>

            <div className="field full">
              <label>
                Reference
              </label>

              <input
                name="reference"
                maxLength={200}
              />
            </div>

            <div className="form-actions">
              <button
                className="button button-primary"
                disabled={
                  busy ||
                  !payableRentals.length
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