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
  FileText,
  History,
  ListChecks,
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
import { RentalAgreement } from "./rental-agreement";
import { RentalRecords } from "./rental-records";

import { getFirebaseClient } from "@/lib/firebase/client";

import {
  firebaseErrorMessage,
  formatFuel,
  formatMoney,
} from "@/lib/presentation";

import type { CloudinaryMedia } from "@/lib/cloudinary";

import {
  AGREEMENT_RATES,
  CHARGE_ROWS,
  PAYMENT_METHODS,
  type AgreementPaymentMethod,
} from "@/lib/agreement";

import {
  callFirestoreOperation,
  type AdditionalFeeType,
  type ContractQueueEntry,
} from "@/lib/services/firestore-client";

import {
  listAssignableStaff,
} from "@/lib/services/staff-directory";

type Tab =
  | "booking"
  | "checkout"
  | "extend"
  | "return"
  | "payment"
  | "past"
  | "records";

type CustomerMode =
  | "existing"
  | "new";

type Customer = {
  id: string;
  fullName: string;
  telephone: string;
  email: string | null;
  address: string | null;
  dateOfBirth: string | null;
  licenceNumber: string;
  licenceCountry: string;
  licenceExpiresAt: string | null;
};

/* The booking screen edits the same fields the customers
   screen does, minus the licence image, which has its own
   capture control. */
type CustomerEdit = {
  fullName: string;
  telephone: string;
  email: string;
  address: string;
  dateOfBirth: string;
  licenceNumber: string;
  licenceCountry: string;
  licenceExpiresAt: string;
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
  pickupAt: string | null;
  expectedReturnAt: string | null;
  /* Extended prices for the agreement's charges table:
     units booked multiplied by the rate quoted at booking. */
  dailyCents: number;
  weeklyCents: number;
  monthlyCents: number;
};

type Rental = {
  id: string;
  customerName: string;
  vehicleRegistration: string;
  pickupOdometerKm: number;
  expectedReturnAt: string | null;
  createdByNameSnapshot: string | null;
  checkedOutByNameSnapshot: string | null;
  /** Taken at the counter and owed back at return. */
  depositCents: number;
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
  {
    id: "past",
    label: "Past booking",
    icon: History,
  },
  {
    id: "records",
    label: "Rental records",
    icon: ListChecks,
  },
];

/*
 * What the renter settles at each end of the hire.
 *
 * At the counter they pay the deposit, the insurance and any
 * waivers, the car seats and the rental days themselves. The
 * fuel and the detailing cannot be known until the car comes
 * back, so those rows are not on the checkout form at all:
 * they are raised as adjustments at return.
 *
 * Daily, weekly and monthly are not entered by hand anywhere
 * — they restate the booking's own quote.
 */
const CHECKOUT_CHARGE_KEYS = [
  "extraHours",
  "insurance",
  "liabilityWaiver",
  "windscreenWaiver",
  "carSeat",
  "other",
] as const;

const agreementChargeRows = CHARGE_ROWS.filter(
  (row) =>
    (
      CHECKOUT_CHARGE_KEYS as readonly string[]
    ).includes(row.key),
);

/*
 * The charges raised when the vehicle comes back. Each is an
 * adjustment on the rental, so the balance the renter settles
 * at return is the rental plus whatever of these applied.
 */
const returnAdjustmentOptions = [
  {
    type: "extension",
    label: "Extension",
  },
  {
    type: "cleaning",
    label: "Cleaning / detailing",
  },
  {
    type: "fuel",
    label: "Refuelling",
  },
  {
    type: "damage",
    label: "Damage",
  },
  {
    type: "late_fee",
    label: "Late fee",
  },
  {
    type: "other",
    label: "Other",
  },
  {
    type: "discount",
    label: "Discount",
  },
] as const;

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

/*
 * Fees that can be added to a payment, grouped by the end of
 * the hire they normally belong to. Both groups stay usable
 * whatever state the rental is in: a car seat charged at the
 * counter but not paid for until the car comes back is still
 * a car seat, and refusing to take it would leave the money
 * off the record.
 */
const paymentFeeOptions = [
  {
    type: "insurance",
    label: "Insurance",
    stage: "checkout",
    selectedName: "fee_insurance_selected",
    amountName: "fee_insurance_amount",
  },
  {
    type: "car_seat",
    label: "Car seat",
    stage: "checkout",
    selectedName: "fee_car_seat_selected",
    amountName: "fee_car_seat_amount",
  },
  {
    type: "extension",
    label: "Extension",
    stage: "return",
    selectedName: "fee_extension_selected",
    amountName: "fee_extension_amount",
  },
  {
    type: "cleaning",
    label: "Cleaning / detailing",
    stage: "return",
    selectedName: "fee_cleaning_selected",
    amountName: "fee_cleaning_amount",
  },
  {
    type: "refueling",
    label: "Refuelling",
    stage: "return",
    selectedName: "fee_refueling_selected",
    amountName: "fee_refueling_amount",
  },
  {
    type: "smoke_fee",
    label: "Smoke fee",
    stage: "return",
    selectedName: "fee_smoke_fee_selected",
    amountName: "fee_smoke_fee_amount",
  },
] as const;

const PAYMENT_FEE_STAGES = [
  {
    id: "checkout",
    heading: "Collected at checkout",
    hint: "Insurance and car seats are settled when the renter takes the vehicle. The deposit is taken on the checkout screen: it is held, not earned, so it never joins the rental balance.",
  },
  {
    id: "return",
    heading: "Collected at return",
    hint: "Extensions, cleaning, detailing and refuelling are settled when the vehicle comes back.",
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

/*
 * One row of the agreement's charges table: the number of
 * daily, weekly or monthly bundles the booking was priced at,
 * multiplied by the rate it was quoted at.
 */
function extendedPrice(
  snapshot: {
    get: (field: string) => unknown;
  },
  unitsField: string,
  rateField: string,
): number {
  const quote = (snapshot.get("quote") ??
    {}) as Record<string, unknown>;

  const rates = (snapshot.get("rateSnapshot") ??
    {}) as Record<string, unknown>;

  const units = Number(
    quote[unitsField] ?? 0,
  );

  const rate = Number(rates[rateField] ?? 0);

  if (
    !Number.isFinite(units) ||
    !Number.isFinite(rate)
  ) {
    return 0;
  }

  return Math.round(units * rate);
}

function bookingMoment(
  value: string | null,
): string {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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

function todayDate(): string {
  const value = new Date();

  const year = value.getFullYear();

  const month = String(
    value.getMonth() + 1,
  ).padStart(2, "0");

  const day = String(
    value.getDate(),
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
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

  /*
   * Held in state rather than left to the form so a completed
   * return can hand the rental straight to the payment tab.
   */
  const [paymentRentalId, setPaymentRentalId] =
    useState("");

  const [
    checkoutReservationId,
    setCheckoutReservationId,
  ] = useState("");

  /*
   * The payment tab's fee inputs are held here rather than
   * read off the form at submit time, so the amount due can be
   * recalculated on screen as the employee types.
   */
  const [selectedFees, setSelectedFees] =
    useState<Record<string, boolean>>({});

  const [feeAmounts, setFeeAmounts] = useState<
    Record<string, string>
  >({});

  const [paymentAmount, setPaymentAmount] =
    useState("");

  /* Cancelling frees the vehicle, so it asks twice. */
  const [cancellingId, setCancellingId] =
    useState<string | null>(null);

  const [cancelReason, setCancelReason] =
    useState("");

  const [cancelBusy, setCancelBusy] =
    useState(false);

  const [bookingMedia, setBookingMedia] =
    useState<CloudinaryMedia[]>([]);

  const [returnMedia, setReturnMedia] =
    useState<CloudinaryMedia[]>([]);

  const [customerSignature, setCustomerSignature] =
    useState<string | null>(null);

  /*
   * A counter without a touchscreen, or a booking taken over
   * the telephone, cannot produce a drawn signature, so the
   * customer's name may be typed instead.
   */
  const [signatureMode, setSignatureMode] =
    useState<"draw" | "type">("draw");

  const [signatureName, setSignatureName] =
    useState("");

  const [checkoutMedia, setCheckoutMedia] =
    useState<CloudinaryMedia[]>([]);

  /*
   * The charge rows the employee fills in. The daily, weekly
   * and monthly rows restate the booking's quote and are not
   * entered here, so they are left out of this list.
   */
  const [agreementCharges, setAgreementCharges] =
    useState<Record<string, string>>({
      liabilityWaiver: "",
      windscreenWaiver: "",
      insurance: "",
      carSeat: "",
      other: "",
      extraHours: "",
    });

  /*
   * The charges raised when the car comes back, by type.
   * Empty means not charged.
   */
  const [returnRentalId, setReturnRentalId] =
    useState("");

  const [
    returnAdjustments,
    setReturnAdjustments,
  ] = useState<Record<string, string>>({});

  const [
    returnAdjustmentNotes,
    setReturnAdjustmentNotes,
  ] = useState<Record<string, string>>({});

  const [depositAmount, setDepositAmount] =
    useState(
      (
        AGREEMENT_RATES.depositCents / 100
      ).toFixed(2),
    );

  const [waivers, setWaivers] = useState({
    liabilityWaiver: false,
    windscreenWaiver: false,
    personalAccidentInsurance: false,
  });

  const [paymentMethod, setPaymentMethod] =
    useState<AgreementPaymentMethod | "">("");

  const [additionalDriver, setAdditionalDriver] =
    useState({
      fullName: "",
      address: "",
      state: "",
      dateOfBirth: "",
      licenceNumber: "",
      licenceExpiresAt: "",
      telephone: "",
      localAddress: "",
    });

  const [contractRentalId, setContractRentalId] =
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

  /*
   * A detail that is wrong at the counter — a new telephone
   * number, a renewed licence — can be corrected here rather
   * than sending the employee to the Customers screen and
   * back. The record is updated in place, so the booking is
   * made against the corrected customer.
   */
  const [customerEdit, setCustomerEdit] =
    useState<CustomerEdit | null>(null);

  const [savingCustomerEdit, setSavingCustomerEdit] =
    useState(false);

  /*
   * A contract submitted from one browser has to be findable
   * from another, or an administrator can never reach the
   * agreement they are supposed to approve.
   */
  /*
   * Who a past booking can be attributed to. Only an
   * administrator may list staff, so an operations account
   * gets itself back and records the rental under its own
   * name; see listAssignableStaff.
   */
  const [assignableStaff, setAssignableStaff] =
    useState<
      Array<{
        uid: string;
        fullName: string;
      }>
    >([]);

  const [contractQueue, setContractQueue] =
    useState<ContractQueueEntry[]>([]);

  const [contractQueueError, setContractQueueError] =
    useState<string>();

  const [error, setError] =
    useState<string>();

  const [notice, setNotice] =
    useState<string>();

  const [busy, setBusy] =
    useState(false);

  const [showContract, setShowContract] =
    useState(false);

  /*
   * An idempotency key has to outlive a single submit to be
   * worth anything: if the write commits but the response is
   * lost, the retry must present the same key so the server
   * replays the stored result instead of charging again. The
   * key is therefore held per operation and only replaced once
   * that operation has actually succeeded.
   */
  const operationKeys =
    useRef<Record<string, string>>({});

  function operationKey(
    operation: string,
  ): string {
    const existing =
      operationKeys.current[operation];

    if (existing) {
      return existing;
    }

    const created =
      crypto.randomUUID();

    operationKeys.current[operation] =
      created;

    return created;
  }

  function releaseOperationKey(
    operation: string,
  ): void {
    delete operationKeys.current[
      operation
    ];
  }

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
            address:
              snapshot.get(
                "address",
              ) ?? null,
            dateOfBirth:
              snapshot.get(
                "dateOfBirth",
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
            pickupAt:
              toDateTimeInput(
                snapshot.get(
                  "pickupAt",
                ),
              ),
            expectedReturnAt:
              toDateTimeInput(
                snapshot.get(
                  "expectedReturnAt",
                ),
              ),
            dailyCents:
              extendedPrice(
                snapshot,
                "dailyUnits",
                "dailyCents",
              ),
            weeklyCents:
              extendedPrice(
                snapshot,
                "weeklyUnits",
                "weeklyCents",
              ),
            monthlyCents:
              extendedPrice(
                snapshot,
                "monthlyUnits",
                "monthlyCents",
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
            depositCents:
              Number(
                (
                  (snapshot.get(
                    "agreement",
                  ) ?? {}) as Record<
                    string,
                    unknown
                  >
                ).depositCents ?? 0,
              ) || 0,
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

  /*
   * The review queue is a convenience panel, not part of
   * taking a booking, so it is read on its own and its
   * failure is confined to the panel. Folding it into load()
   * meant one unreadable collection — most likely security
   * rules that have not been deployed yet — left the desk
   * with no vehicles, no reservations and no way to work.
   */
  async function loadContractQueue(
    isCancelled: () => boolean = () => false,
  ) {
    try {
      const entries =
        await callFirestoreOperation<
          undefined,
          ContractQueueEntry[]
        >(
          "listContractsForReview",
          undefined,
        );

      if (isCancelled()) {
        return;
      }

      setContractQueue(entries);
      setContractQueueError(undefined);
    } catch (cause) {
      if (isCancelled()) {
        return;
      }

      setContractQueue([]);

      setContractQueueError(
        firebaseErrorMessage(cause),
      );
    }
  }

  async function loadPayableRentals(
    isCancelled: () => boolean = () => false,
  ) {
    try {
      const records =
        await callFirestoreOperation<
          Record<string, never>,
          PayableRental[]
        >(
          "getPayableRentals",
          {},
        );

      if (isCancelled()) {
        return;
      }

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
          void loadContractQueue();
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
      tab !== "payment"
    ) {
      return;
    }

    let cancelled = false;

    /*
     * Opening the payment tab re-reads the outstanding
     * balances so the list cannot show a rental that was
     * already settled from another screen. The initial load and
     * a post-operation reload can still be in flight, so a
     * response that arrives after this effect is torn down is
     * discarded rather than overwriting a newer list.
     */
    async function refreshPayableRentals() {
      await loadPayableRentals(
        () => cancelled,
      );
    }

    void refreshPayableRentals();

    return () => {
      cancelled = true;
    };
  }, [tab]);

  useEffect(() => {
    if (tab !== "past") {
      return;
    }

    let cancelled = false;

    async function loadStaff() {
      const staff =
        await listAssignableStaff();

      if (!cancelled) {
        setAssignableStaff(staff);
      }
    }

    void loadStaff();

    return () => {
      cancelled = true;
    };
  }, [tab]);

  /*
   * A rental the office already ran, typed in from the paper
   * file. Nothing is reserved and no vehicle changes status:
   * the record is written as a closed rental and flagged as
   * historical so no screen counts it as a car that is out.
   */
  function recordPastBooking(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const formElement =
      event.currentTarget;

    const form = new FormData(
      formElement,
    );

    const paidCents = dollarsToCents(
      form.get("paidAmount"),
    );

    void run(async () => {
      /* Parsed inside the task so a malformed date is
         reported through the screen's error banner rather
         than thrown past it. */
      const pickupAt = localToIso(
        form.get("pickupAt"),
      );

      const returnedAt = localToIso(
        form.get("returnedAt"),
      );

      await callFirestoreOperation<
        {
          customerId: string;
          vehicleId: string;
          pickupAt: string;
          returnedAt: string;
          handledByUid: string | null;
          baseRentalCents: number;
          additionalChargesCents: number;
          paidCents: number;
          paymentMethod: string | null;
          pickupLocation: string | null;
          dropoffLocation: string | null;
          notes: string | null;
          idempotencyKey: string;
        },
        {
          rentalId: string;
          reservationId: string;
        }
      >("recordPastRental", {
        customerId: String(
          form.get("customerId") ?? "",
        ),

        vehicleId: String(
          form.get("vehicleId") ?? "",
        ),

        pickupAt,

        returnedAt,

        handledByUid:
          String(
            form.get("handledByUid") ?? "",
          ).trim() || null,

        baseRentalCents: dollarsToCents(
          form.get("rentalAmount"),
        ),

        additionalChargesCents:
          dollarsToCents(
            form.get("additionalAmount"),
          ),

        paidCents,

        paymentMethod:
          paidCents > 0
            ? String(
                form.get("paymentMethod") ??
                  "cash",
              )
            : null,

        pickupLocation:
          String(
            form.get("pickupLocation") ?? "",
          ).trim() || null,

        dropoffLocation:
          String(
            form.get("dropoffLocation") ??
              "",
          ).trim() || null,

        notes:
          String(
            form.get("notes") ?? "",
          ).trim() || null,

        idempotencyKey: operationKey(
          "past-rental",
        ),
      });

      releaseOperationKey("past-rental");

      formElement.reset();

      return "Past booking recorded. It is listed under Rental records as a past booking.";
    });
  }

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

  function startCustomerEdit() {
    if (!selectedCustomer) {
      return;
    }

    setError(undefined);
    setNotice(undefined);

    setCustomerEdit({
      fullName:
        selectedCustomer.fullName,

      telephone:
        selectedCustomer.telephone,

      email:
        selectedCustomer.email ?? "",

      address:
        selectedCustomer.address ?? "",

      dateOfBirth:
        selectedCustomer.dateOfBirth
          ? selectedCustomer.dateOfBirth.slice(
              0,
              10,
            )
          : "",

      licenceNumber:
        selectedCustomer.licenceNumber,

      licenceCountry:
        selectedCustomer.licenceCountry,

      licenceExpiresAt:
        selectedCustomer.licenceExpiresAt
          ? selectedCustomer.licenceExpiresAt.slice(
              0,
              10,
            )
          : "",
    });
  }

  async function saveCustomerEdit() {
    if (
      !customerEdit ||
      !selectedCustomerId
    ) {
      return;
    }

    const fullName =
      customerEdit.fullName.trim();

    const telephone =
      customerEdit.telephone.trim();

    const licenceNumber =
      customerEdit.licenceNumber
        .trim()
        .toUpperCase();

    const licenceCountry =
      customerEdit.licenceCountry
        .trim()
        .toUpperCase();

    const licenceExpiresAt =
      customerEdit.licenceExpiresAt.trim();

    setError(undefined);
    setNotice(undefined);

    if (
      !fullName ||
      !telephone ||
      !licenceNumber ||
      licenceCountry.length !== 2 ||
      !licenceExpiresAt
    ) {
      setError(
        "Complete the required customer details before saving.",
      );

      return;
    }

    const today = new Date();

    today.setHours(0, 0, 0, 0);

    const expiry = new Date(
      `${licenceExpiresAt}T00:00:00`,
    );

    expiry.setHours(0, 0, 0, 0);

    if (
      Number.isNaN(expiry.getTime()) ||
      expiry.getTime() <= today.getTime()
    ) {
      setError(
        "Licence expiry must be after today.",
      );

      return;
    }

    setSavingCustomerEdit(true);

    try {
      await callFirestoreOperation<
        {
          customerId: string;
          fullName: string;
          telephone: string;
          email: string | null;
          address: string | null;
          dateOfBirth: string | null;
          licenceNumber: string;
          licenceCountry: string;
          licenceExpiresAt: string;
        },
        { customerId: string }
      >("createOrUpdateCustomer", {
        customerId: selectedCustomerId,

        fullName,
        telephone,

        email:
          customerEdit.email.trim() || null,

        address:
          customerEdit.address.trim() || null,

        dateOfBirth:
          customerEdit.dateOfBirth.trim() ||
          null,

        licenceNumber,
        licenceCountry,
        licenceExpiresAt,
      });

      /*
       * The picker reads from the list this screen loaded, so
       * it is re-read before the editor closes and the
       * selected customer shows the corrected details.
       */
      await load();

      setCustomerEdit(null);

      setNotice(
        "Customer details updated.",
      );
    } catch (cause) {
      setError(
        firebaseErrorMessage(cause),
      );
    } finally {
      setSavingCustomerEdit(false);
    }
  }

  /*
   * The form collects dollars; everything below the surface is
   * whole cents, so the conversion happens once, here.
   */
  function dollarsToCents(
    value: FormDataEntryValue | null,
  ): number {
    const amount = Number(
      String(value ?? "").trim() || 0,
    );

    if (!Number.isFinite(amount) || amount < 0) {
      return 0;
    }

    return Math.round(amount * 100);
  }

  /*
   * The printed charges table: the rental days as the booking
   * quoted them, plus whatever the employee typed in.
   */
  const checkoutReservationQuote =
    reservations.find(
      (reservation) =>
        reservation.id ===
        checkoutReservationId,
    );

  const quotedCharges: Record<string, number> =
    {
      daily:
        checkoutReservationQuote?.dailyCents ??
        0,
      weekly:
        checkoutReservationQuote?.weeklyCents ??
        0,
      monthly:
        checkoutReservationQuote?.monthlyCents ??
        0,

      ...Object.fromEntries(
        agreementChargeRows.map((row) => [
          row.key,
          Math.round(
            (Number(
              agreementCharges[row.key] || 0,
            ) || 0) * 100,
          ),
        ]),
      ),
    };

  const agreementTotalCents = Object.values(
    quotedCharges,
  ).reduce(
    (sum, cents) => sum + Number(cents || 0),
    0,
  );

  /*
   * What the renter actually hands over at the counter: the
   * charges on the agreement plus the refundable deposit.
   * The deposit is shown separately because it is held, not
   * earned, and never reaches the rental's balance.
   */
  const checkoutDepositCents = (() => {
    const amount = Number(
      depositAmount || 0,
    );

    return Number.isFinite(amount) &&
      amount > 0
      ? Math.round(amount * 100)
      : 0;
  })();

  const dueAtCheckoutCents =
    agreementTotalCents +
    checkoutDepositCents;

  /*
   * A discount comes off the balance; everything else is
   * added to it, which is exactly how the return applies
   * them.
   */
  const returnRental = rentals.find(
    (rental) => rental.id === returnRentalId,
  );

  const returnAdjustmentTotalCents =
    returnAdjustmentOptions.reduce(
      (sum, option) => {
        const amount = Number(
          returnAdjustments[option.type] || 0,
        );

        if (
          !Number.isFinite(amount) ||
          amount <= 0
        ) {
          return sum;
        }

        const cents = Math.round(
          amount * 100,
        );

        return option.type === "discount"
          ? sum - cents
          : sum + cents;
      },
      0,
    );

  const selectedPayableRental =
    payableRentals.find(
      (rental) =>
        rental.id === paymentRentalId,
    );

  const additionalFeesCents =
    paymentFeeOptions.reduce((sum, fee) => {
      if (!selectedFees[fee.type]) {
        return sum;
      }

      const amount = Number(
        feeAmounts[fee.type] || 0,
      );

      return Number.isFinite(amount) &&
        amount > 0
        ? sum + Math.round(amount * 100)
        : sum;
    }, 0);

  const totalDueCents =
    (selectedPayableRental?.outstandingCents ??
      0) + additionalFeesCents;

  const paidNowCents = (() => {
    const amount = Number(paymentAmount || 0);

    return Number.isFinite(amount) && amount > 0
      ? Math.round(amount * 100)
      : 0;
  })();

  const balanceAfterPayment = Math.max(
    totalDueCents - paidNowCents,
    0,
  );

  async function cancelBooking(
    reservation: Reservation,
  ) {
    setCancelBusy(true);
    setError(undefined);
    setNotice(undefined);

    try {
      const result =
        await callFirestoreOperation<
          {
            reservationId: string;
            reason: string | null;
          },
          {
            reservationId: string;
            vehicleReleased: boolean;
          }
        >("cancelReservation", {
          reservationId: reservation.id,
          reason:
            cancelReason.trim() || null,
        });

      setCancellingId(null);
      setCancelReason("");

      await load();

      setNotice(
        result.vehicleReleased
          ? `Booking cancelled · ${reservation.vehicleRegistration} is available again.`
          : "Booking cancelled.",
      );
    } catch (cause) {
      setError(
        firebaseErrorMessage(cause),
      );
    } finally {
      setCancelBusy(false);
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

              /*
               * The condition photos are taken at checkout
               * now, with the car in front of the renter, so
               * a booking carries none.
               */
              bookingMedia: [],
            },
          );

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
        )}. Check the vehicle out to sign and issue the rental agreement.`;
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
              checkoutMedia: CloudinaryMedia[];
              customerSignatureDataUrl:
                | string
                | null;
              customerSignatureName:
                | string
                | null;
              additionalDriver:
                | Record<string, string>
                | null;
              waivers: Record<string, boolean>;
              depositCents: number;
              paymentMethod: string | null;
              paymentReferenceLast4:
                | string
                | null;
              paymentCardHolder:
                | string
                | null;
              charges: Record<string, number>;
              specialInstructions:
                | string
                | null;
              extraHours: number;
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

              checkoutMedia,

              customerSignatureDataUrl:
                signatureMode === "draw"
                  ? customerSignature
                  : null,

              customerSignatureName:
                signatureMode === "type"
                  ? signatureName.trim() ||
                    null
                  : null,

              additionalDriver:
                additionalDriver.fullName.trim()
                  ? additionalDriver
                  : null,

              waivers,

              depositCents: dollarsToCents(
                form.get("depositAmount"),
              ),

              paymentMethod:
                paymentMethod || null,

              paymentReferenceLast4:
                String(
                  form.get("paymentLast4") ??
                    "",
                ).trim() || null,

              paymentCardHolder:
                String(
                  form.get(
                    "paymentCardHolder",
                  ) ?? "",
                ).trim() || null,

              charges: quotedCharges,

              specialInstructions:
                String(
                  form.get("notes"),
                ).trim() || null,

              extraHours: Number(
                form.get("extraHours") ?? 0,
              ),
            },
          );

        formElement.reset();

        setCheckoutReservationId("");
        setCheckoutMedia([]);
        setCustomerSignature(null);
        setSignatureName("");
        setPaymentMethod("");

        setDepositAmount(
          (
            AGREEMENT_RATES.depositCents / 100
          ).toFixed(2),
        );

        setAgreementCharges({
          liabilityWaiver: "",
          windscreenWaiver: "",
          insurance: "",
          carSeat: "",
          other: "",
          extraHours: "",
        });

        setWaivers({
          liabilityWaiver: false,
          windscreenWaiver: false,
          personalAccidentInsurance: false,
        });

        setAdditionalDriver({
          fullName: "",
          address: "",
          state: "",
          dateOfBirth: "",
          licenceNumber: "",
          licenceExpiresAt: "",
          telephone: "",
          localAddress: "",
        });

        /*
         * The agreement is issued here, not at booking: this
         * is the document the renter has just signed for the
         * vehicle in front of them.
         */
        setContractRentalId(result.rentalId);

        setShowContract(true);

        return `Vehicle checked out · rental agreement ready to print.`;
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
                operationKey("extension"),
            },
          );

        releaseOperationKey("extension");

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

    const returnedRentalId = String(
      form.get("rentalId") ?? "",
    );

    void run(
      async () => {
        /*
         * Every charge raised at return in one submission:
         * an extension, the cleaning and a tank of fuel are
         * routinely owed on the same car, and entering them
         * one at a time meant three returns or two of them
         * quietly lost.
         */
        const adjustments: Array<{
          type: string;
          amountCents: number;
          note: string;
        }> = [];

        for (const option of returnAdjustmentOptions) {
          const raw = String(
            returnAdjustments[option.type] ??
              "",
          ).trim();

          if (!raw) {
            continue;
          }

          const amountCents = Math.round(
            Number(raw) * 100,
          );

          if (
            !Number.isFinite(amountCents) ||
            amountCents <= 0
          ) {
            throw new Error(
              `${option.label} must be an amount greater than zero.`,
            );
          }

          adjustments.push({
            type: option.type,

            amountCents,

            note:
              String(
                returnAdjustmentNotes[
                  option.type
                ] ?? "",
              ).trim() || option.label,
          });
        }

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
              rentalId: returnedRentalId,

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

        setReturnRentalId("");
        setReturnAdjustments({});
        setReturnAdjustmentNotes({});

        /*
         * A return that leaves a balance goes straight to the
         * payment tab with the rental already chosen, so the
         * desk can settle it while the customer is still at
         * the counter.
         */
        if (result.outstandingCents > 0) {
          setPaymentRentalId(returnedRentalId);

          setTab("payment");

          return `Return completed · ${formatMoney(
            result.outstandingCents,
          )} outstanding. Take the payment below.`;
        }

        return `Return completed · nothing left to pay.`;
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

        const paymentAmountCents =
          Math.round(
            Number(
              String(
                form.get("amount") ?? "",
              ).trim(),
            ) * 100,
          );

        if (
          !Number.isFinite(
            paymentAmountCents,
          ) ||
          paymentAmountCents <= 0
        ) {
          throw new Error(
            "Payment amount must be greater than zero.",
          );
        }

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
                type: AdditionalFeeType;
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
                paymentAmountCents,

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
                operationKey("payment"),
            },
          );

        releaseOperationKey("payment");

        formElement.reset();

        /* reset() cannot clear controlled inputs. */
        setPaymentRentalId("");
        setPaymentAmount("");
        setSelectedFees({});
        setFeeAmounts({});

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
          <span>{notice}</span>

          {contractRentalId && (
            <button
              className="button button-secondary compact"
              type="button"
              onClick={() =>
                setShowContract(true)
              }
            >
              <FileText size={15} />
              Rental agreement
            </button>
          )}
        </div>
      )}

      {showContract &&
        contractRentalId && (
          <RentalAgreement
            rentalId={contractRentalId}
            onClose={() => {
              setShowContract(false);

              /* A decision taken in the dialog changes what
                 is still waiting for review. */
              void loadContractQueue();
            }}
          />
        )}

      {tab === "booking" &&
        reservations.length > 0 && (
          <section className="surface booking-list">
            <p className="section-kicker">
              Bookings awaiting checkout
            </p>

            <ul>
              {reservations.map(
                (reservation) => (
                  <li
                    key={reservation.id}
                  >
                    <span className="booking-list-detail">
                      <strong>
                        {
                          reservation.vehicleRegistration
                        }
                      </strong>

                      <small>
                        {
                          reservation.customerName
                        }
                        {reservation.pickupAt
                          ? ` · ${bookingMoment(
                              reservation.pickupAt,
                            )} → ${bookingMoment(
                              reservation.expectedReturnAt,
                            )}`
                          : ""}
                      </small>
                    </span>

                    {cancellingId ===
                    reservation.id ? (
                      <span className="booking-list-confirm">
                        <input
                          aria-label="Reason for cancelling"
                          placeholder="Reason (optional)"
                          maxLength={500}
                          value={cancelReason}
                          disabled={cancelBusy}
                          onChange={(
                            event,
                          ) =>
                            setCancelReason(
                              event.target
                                .value,
                            )
                          }
                        />

                        <button
                          className="button button-danger compact"
                          type="button"
                          disabled={cancelBusy}
                          onClick={() =>
                            void cancelBooking(
                              reservation,
                            )
                          }
                        >
                          {cancelBusy
                            ? "Cancelling…"
                            : "Yes, cancel"}
                        </button>

                        <button
                          className="text-button"
                          type="button"
                          disabled={cancelBusy}
                          onClick={() => {
                            setCancellingId(
                              null,
                            );

                            setCancelReason(
                              "",
                            );
                          }}
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        className="button button-secondary compact"
                        type="button"
                        onClick={() => {
                          setError(
                            undefined,
                          );

                          setNotice(
                            undefined,
                          );

                          setCancelReason(
                            "",
                          );

                          setCancellingId(
                            reservation.id,
                          );
                        }}
                      >
                        <X size={15} />
                        Cancel booking
                      </button>
                    )}
                  </li>
                ),
              )}
            </ul>
          </section>
        )}

      {tab === "booking" &&
        (contractQueue.length > 0 ||
          contractQueueError) && (
          <section className="surface contract-queue">
            <p className="section-kicker">
              Contracts awaiting a decision
            </p>

            {contractQueueError && (
              <p className="form-help">
                The review queue could not be
                loaded, so contracts waiting for
                a decision are not listed here.
                Bookings are unaffected.{" "}
                {contractQueueError}
              </p>
            )}

            <ul>
              {contractQueue.map(
                (entry) => (
                  <li
                    key={
                      entry.reservationId
                    }
                  >
                    <span
                      className={
                        entry.status ===
                        "rejected"
                          ? "status-pill overdue"
                          : "status-pill cleaning"
                      }
                    >
                      {entry.status ===
                      "rejected"
                        ? "Rejected"
                        : "Waiting for review"}
                    </span>

                    <span className="contract-queue-detail">
                      <strong>
                        {
                          entry.vehicleRegistration
                        }
                      </strong>

                      <small>
                        {
                          entry.customerName
                        }
                        {" · version "}
                        {entry.version}
                        {entry.submittedByNameSnapshot
                          ? ` · submitted by ${entry.submittedByNameSnapshot}`
                          : ""}
                      </small>

                      {entry.reviewNote && (
                        <small>
                          {entry.reviewNote}
                        </small>
                      )}
                    </span>

                    <button
                      className="button button-secondary compact"
                      type="button"
                      disabled={
                        !entry.rentalId
                      }
                      onClick={() => {
                        if (!entry.rentalId) {
                          return;
                        }

                        setContractRentalId(
                          entry.rentalId,
                        );

                        setShowContract(true);
                      }}
                    >
                      <FileText
                        size={15}
                      />
                      Open
                    </button>
                  </li>
                ),
              )}
            </ul>
          </section>
        )}

      {tab === "records" && (
        <section className="surface ledger-surface">
          <div className="section-heading">
            <div>
              <p className="section-kicker">
                Rental records
              </p>

              <h2>
                Who rented what, and to whom
              </h2>

              <p>
                Every rental the office has
                run, live or closed, with the
                staff member who handled it.
                Bookings typed in from the
                paper file are marked as past
                bookings.
              </p>
            </div>
          </div>

          <RentalRecords limit={300} />
        </section>
      )}

      {/* The records tab renders its own surface above. */}
      {tab !== "records" && (
      <section className="workflow-shell surface">
        {tab === "past" && (
          <form
            className="form-grid"
            onSubmit={recordPastBooking}
          >
            <div className="form-section">
              <p className="section-kicker">
                Past booking
              </p>

              <h2>
                Record a rental that already
                happened
              </h2>

              <p>
                For a rental the office ran
                before this system, or while
                it was unavailable. Nothing is
                reserved and no vehicle
                changes status: the record is
                written as a closed rental and
                listed as a past booking.
              </p>
            </div>

            <div className="field">
              <label htmlFor="past-customer">
                Customer
              </label>

              <select
                id="past-customer"
                name="customerId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Select customer
                </option>

                {customers.map(
                  (customer) => (
                    <option
                      value={customer.id}
                      key={customer.id}
                    >
                      {customer.fullName}
                      {" · "}
                      {customer.telephone}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div className="field">
              <label htmlFor="past-vehicle">
                Vehicle
              </label>

              <select
                id="past-vehicle"
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
                    {
                      vehicle.registrationNumber
                    }
                    {" · "}
                    {vehicle.make}
                    {" "}
                    {vehicle.model}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="past-pickup">
                Rental start
              </label>

              <input
                id="past-pickup"
                name="pickupAt"
                type="datetime-local"
                max={todayDateTime()}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="past-return">
                Return
              </label>

              <input
                id="past-return"
                name="returnedAt"
                type="datetime-local"
                max={todayDateTime()}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="past-handled-by">
                Handled by
              </label>

              <select
                id="past-handled-by"
                name="handledByUid"
                defaultValue=""
              >
                <option value="">
                  Me
                </option>

                {assignableStaff.map(
                  (member) => (
                    <option
                      value={member.uid}
                      key={member.uid}
                    >
                      {member.fullName}
                    </option>
                  ),
                )}
              </select>

              <p className="form-help">
                The staff member who rented the
                vehicle out at the time. The
                name is read from their own
                profile, not from this form.
              </p>
            </div>

            <div className="field">
              <label htmlFor="past-rental-amount">
                Rental charged (USD)
              </label>

              <input
                id="past-rental-amount"
                name="rentalAmount"
                type="number"
                min="0.01"
                max="100000"
                step="0.01"
                inputMode="decimal"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="past-additional-amount">
                Additional charges (USD)
              </label>

              <input
                id="past-additional-amount"
                name="additionalAmount"
                type="number"
                min="0"
                max="100000"
                step="0.01"
                inputMode="decimal"
                defaultValue="0"
              />

              <p className="form-help">
                Fuel, cleaning, damage and the
                rest, as one figure.
              </p>
            </div>

            <div className="field">
              <label htmlFor="past-paid-amount">
                Amount received (USD)
              </label>

              <input
                id="past-paid-amount"
                name="paidAmount"
                type="number"
                min="0"
                max="100000"
                step="0.01"
                inputMode="decimal"
                defaultValue="0"
              />
            </div>

            <div className="field">
              <label htmlFor="past-payment-method">
                Payment method
              </label>

              <select
                id="past-payment-method"
                name="paymentMethod"
                defaultValue="cash"
              >
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

            <div className="field">
              <label htmlFor="past-pickup-location">
                Pickup location
              </label>

              <input
                id="past-pickup-location"
                name="pickupLocation"
                maxLength={160}
              />
            </div>

            <div className="field">
              <label htmlFor="past-dropoff-location">
                Drop-off location
              </label>

              <input
                id="past-dropoff-location"
                name="dropoffLocation"
                maxLength={160}
              />
            </div>

            <div className="field full">
              <label htmlFor="past-notes">
                Notes
              </label>

              <textarea
                id="past-notes"
                name="notes"
                maxLength={1000}
              />
            </div>

            <div className="form-actions">
              <button
                className="button button-primary"
                disabled={
                  busy ||
                  !customers.length ||
                  !vehicles.length
                }
              >
                Record past booking
              </button>
            </div>
          </form>
        )}

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
                Select the customer, select
                the vehicle and confirm the
                reservation. The condition
                photos, the signature and the
                agreement are taken at
                checkout.
              </p>
            </div>

            <div className="field full">
              <div className="label-row">
                <label htmlFor="customer">
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
                      id="customer"
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

                      <div className="row-actions">
                        <button
                          className="text-button"
                          type="button"
                          onClick={
                            startCustomerEdit
                          }
                        >
                          Edit details
                        </button>

                        <button
                          className="text-button"
                          type="button"
                          onClick={() => {
                            setCustomerEdit(
                              null,
                            );

                            setSelectedCustomerId(
                              "",
                            );
                          }}
                        >
                          Change
                        </button>
                      </div>
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

                  {selectedCustomer &&
                    customerEdit && (
                      <div className="inline-customer-form customer-edit-form">
                        <div className="field">
                          <label htmlFor="edit-full-name">
                            Full name
                          </label>

                          <input
                            id="edit-full-name"
                            value={
                              customerEdit.fullName
                            }
                            onChange={(
                              event,
                            ) =>
                              setCustomerEdit({
                                ...customerEdit,
                                fullName:
                                  event
                                    .target
                                    .value,
                              })
                            }
                          />
                        </div>

                        <div className="field">
                          <label htmlFor="edit-telephone">
                            Telephone
                          </label>

                          <input
                            id="edit-telephone"
                            inputMode="tel"
                            value={
                              customerEdit.telephone
                            }
                            onChange={(
                              event,
                            ) =>
                              setCustomerEdit({
                                ...customerEdit,
                                telephone:
                                  event
                                    .target
                                    .value,
                              })
                            }
                          />
                        </div>

                        <div className="field">
                          <label htmlFor="edit-email">
                            Email
                          </label>

                          <input
                            id="edit-email"
                            type="email"
                            value={
                              customerEdit.email
                            }
                            onChange={(
                              event,
                            ) =>
                              setCustomerEdit({
                                ...customerEdit,
                                email:
                                  event
                                    .target
                                    .value,
                              })
                            }
                          />
                        </div>

                        <div className="field">
                          <label htmlFor="edit-licence-number">
                            Licence number
                          </label>

                          <input
                            id="edit-licence-number"
                            value={
                              customerEdit.licenceNumber
                            }
                            onChange={(
                              event,
                            ) =>
                              setCustomerEdit({
                                ...customerEdit,
                                licenceNumber:
                                  event
                                    .target
                                    .value,
                              })
                            }
                          />
                        </div>

                        <div className="field">
                          <label htmlFor="edit-issuing-country">
                            Issuing country
                          </label>

                          <CountrySelect
                            id="edit-issuing-country"
                            value={
                              customerEdit.licenceCountry
                            }
                            onChange={(
                              event,
                            ) =>
                              setCustomerEdit({
                                ...customerEdit,
                                licenceCountry:
                                  event
                                    .target
                                    .value,
                              })
                            }
                          />
                        </div>

                        <div className="field">
                          <label htmlFor="edit-date-of-birth">
                            Date of birth
                          </label>

                          <input
                            id="edit-date-of-birth"
                            type="date"
                            max={todayDate()}
                            value={
                              customerEdit.dateOfBirth
                            }
                            onChange={(
                              event,
                            ) =>
                              setCustomerEdit({
                                ...customerEdit,
                                dateOfBirth:
                                  event
                                    .target
                                    .value,
                              })
                            }
                          />
                        </div>

                        <div className="field">
                          <label htmlFor="edit-licence-expiry">
                            Licence expiry
                          </label>

                          <input
                            id="edit-licence-expiry"
                            type="date"
                            min={tomorrowDate()}
                            value={
                              customerEdit.licenceExpiresAt
                            }
                            onChange={(
                              event,
                            ) =>
                              setCustomerEdit({
                                ...customerEdit,
                                licenceExpiresAt:
                                  event
                                    .target
                                    .value,
                              })
                            }
                          />
                        </div>

                        <div className="field full">
                          <label htmlFor="edit-address">
                            Address
                          </label>

                          <input
                            id="edit-address"
                            value={
                              customerEdit.address
                            }
                            onChange={(
                              event,
                            ) =>
                              setCustomerEdit({
                                ...customerEdit,
                                address:
                                  event
                                    .target
                                    .value,
                              })
                            }
                          />
                        </div>

                        <div className="form-actions">
                          <button
                            className="button button-primary compact"
                            type="button"
                            disabled={
                              savingCustomerEdit
                            }
                            onClick={() =>
                              void saveCustomerEdit()
                            }
                          >
                            {savingCustomerEdit
                              ? "Saving…"
                              : "Save customer"}
                          </button>

                          <button
                            className="button button-secondary compact"
                            type="button"
                            disabled={
                              savingCustomerEdit
                            }
                            onClick={() =>
                              setCustomerEdit(
                                null,
                              )
                            }
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                </div>
              ) : (
                <div className="inline-customer-form">
                  <div className="field">
                    <label htmlFor="full-name">
                      Full name
                    </label>

                    <input
                      id="full-name"
                      name="newCustomerFullName"
                      autoComplete="name"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="telephone">
                      Telephone
                    </label>

                    <input
                      id="telephone"
                      name="newCustomerTelephone"
                      autoComplete="tel"
                      inputMode="tel"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="email">
                      Email
                    </label>

                    <input
                      id="email"
                      name="newCustomerEmail"
                      type="email"
                      autoComplete="email"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="date-of-birth">
                      Date of birth
                    </label>

                    <input
                      id="date-of-birth"
                      name="newCustomerDateOfBirth"
                      type="date"
                      max={todayDate()}
                      autoComplete="bday"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="licence-number">
                      Licence number
                    </label>

                    <input
                      id="licence-number"
                      name="newCustomerLicence"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="issuing-country">
                      Issuing country
                    </label>

                    <CountrySelect
                      id="issuing-country"
                      name="newCustomerCountry"
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="licence-expiry">
                      Licence expiry
                    </label>

                    <input
                      id="licence-expiry"
                      name="newCustomerExpiry"
                      type="date"
                      min={tomorrowDate()}
                      required
                    />
                  </div>

                  <div className="field full">
                    <label htmlFor="address">
                      Address
                    </label>

                    <input
                      id="address"
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
                          Capture the driver&apos;s
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

                              dateOfBirth:
                                (
                                  document.querySelector<HTMLInputElement>(
                                    'input[name="newCustomerDateOfBirth"]',
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
              <label htmlFor="vehicle">
                Vehicle
              </label>

              <select
                id="vehicle"
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
              <label htmlFor="pickup">
                Pickup
              </label>

              <input
                id="pickup"
                name="pickupAt"
                type="datetime-local"
                min={todayDateTime()}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="expected-return">
                Expected return
              </label>

              <input
                id="expected-return"
                name="expectedReturnAt"
                type="datetime-local"
                min={todayDateTime()}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="pickup-location">
                Pickup location
              </label>

              <input
                id="pickup-location"
                name="pickupLocation"
                type="text"
                maxLength={300}
                placeholder="e.g. Downtown office"
              />
            </div>

            <div className="field">
              <label htmlFor="drop-off-location">
                Drop-off location
              </label>

              <input
                id="drop-off-location"
                name="dropoffLocation"
                type="text"
                maxLength={300}
                placeholder="e.g. Airport terminal"
              />
            </div>

            <div className="field full">
              <label htmlFor="booking-note">
                Booking note
              </label>

              <textarea
                id="booking-note"
                name="notes"
              />
            </div>

            <div className="form-actions">
              <button
                className="button button-primary"
                disabled={
                  busy ||
                  !selectedCustomerId ||
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
              <label htmlFor="confirmed-booking">
                Confirmed booking
              </label>

              <select
                id="confirmed-booking"
                name="reservationId"
                required
                value={checkoutReservationId}
                onChange={(event) =>
                  setCheckoutReservationId(
                    event.target.value,
                  )
                }
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
              <label htmlFor="pickup-odometer">
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
                  id="pickup-odometer"
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
              <label htmlFor="pickup-fuel">
                Pickup fuel
              </label>

              <select
                id="pickup-fuel"
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
              <label htmlFor="checkout-note">
                Special instruction, additional
                information
              </label>

              <textarea
                id="checkout-note"
                name="notes"
              />
            </div>

            <div className="field">
              <label htmlFor="extra-hours">
                Extra hours
              </label>

              <input
                id="extra-hours"
                name="extraHours"
                type="number"
                min={0}
                max={999}
                step={1}
                defaultValue={0}
              />
            </div>

            <div className="field">
              <label htmlFor="deposit">
                Deposit (USD)
              </label>

              <input
                id="deposit"
                name="depositAmount"
                type="number"
                min={0}
                step="0.01"
                value={depositAmount}
                onChange={(event) =>
                  setDepositAmount(
                    event.target.value,
                  )
                }
              />

              <p className="form-help">
                Taken at the counter and held
                against the rental. It is
                refundable, so it is recorded
                beside the balance rather than
                added to it.
              </p>
            </div>

            {/* ------------------ waivers and charges */}
            <fieldset className="field full checkout-block">
              <legend>
                Due at checkout
              </legend>

              <p className="form-help">
                What the renter settles at the
                counter: the rental days from
                the booking quote, the deposit
                above, and the insurance,
                waivers and car seats below.
                Fuel, cleaning and detailing
                are not entered here — they are
                raised at return, when the
                vehicle has been seen.
              </p>

              <div className="checkout-charges">
                {agreementChargeRows.map(
                  (row) => (
                    <div
                      className="field"
                      key={row.key}
                    >
                      <label
                        htmlFor={`charge-${row.key}`}
                      >
                        {row.label}
                      </label>

                      <input
                        id={`charge-${row.key}`}
                        type="number"
                        min={0}
                        step="0.01"
                        value={
                          agreementCharges[
                            row.key
                          ] ?? ""
                        }
                        onChange={(event) =>
                          setAgreementCharges(
                            (current) => ({
                              ...current,
                              [row.key]:
                                event.target
                                  .value,
                            }),
                          )
                        }
                      />
                    </div>
                  ),
                )}
              </div>

              <div className="checkout-waivers">
                {[
                  [
                    "liabilityWaiver",
                    "Liability waiver",
                  ],
                  [
                    "windscreenWaiver",
                    "Windscreen waiver",
                  ],
                  [
                    "personalAccidentInsurance",
                    "Personal accident insurance",
                  ],
                ].map(([key, label]) => (
                  <label
                    className="checkbox-row"
                    key={key}
                  >
                    <input
                      type="checkbox"
                      checked={
                        waivers[
                          key as keyof typeof waivers
                        ]
                      }
                      onChange={(event) =>
                        setWaivers(
                          (current) => ({
                            ...current,
                            [key]:
                              event.target
                                .checked,
                          }),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            {checkoutReservationQuote && (
              <div className="field full payment-due">
                <dl>
                  <div>
                    <dt>Rental days</dt>
                    <dd>
                      {formatMoney(
                        (quotedCharges.daily ??
                          0) +
                          (quotedCharges.weekly ??
                            0) +
                          (quotedCharges.monthly ??
                            0),
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Insurance, waivers and
                      extras
                    </dt>
                    <dd>
                      {formatMoney(
                        agreementTotalCents -
                          (quotedCharges.daily ??
                            0) -
                          (quotedCharges.weekly ??
                            0) -
                          (quotedCharges.monthly ??
                            0),
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Deposit (refundable)
                    </dt>
                    <dd>
                      {formatMoney(
                        checkoutDepositCents,
                      )}
                    </dd>
                  </div>

                  <div className="payment-due-total">
                    <dt>Due at checkout</dt>
                    <dd>
                      {formatMoney(
                        dueAtCheckoutCents,
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            {/* ------------------- payment information */}
            <fieldset className="field full checkout-block">
              <legend>
                Payment information
              </legend>

              <div className="checkout-methods">
                {PAYMENT_METHODS.map(
                  (method) => (
                    <label
                      className="checkbox-row"
                      key={method.value}
                    >
                      <input
                        type="radio"
                        name="agreementPaymentMethod"
                        checked={
                          paymentMethod ===
                          method.value
                        }
                        onChange={() =>
                          setPaymentMethod(
                            method.value,
                          )
                        }
                      />
                      {method.label}
                    </label>
                  ),
                )}
              </div>

              <div className="checkout-charges">
                <div className="field">
                  <label htmlFor="payment-last4">
                    Card / check last 4 digits
                  </label>

                  <input
                    id="payment-last4"
                    name="paymentLast4"
                    inputMode="numeric"
                    maxLength={4}
                    pattern="[0-9]{4}"
                  />

                  <p className="form-help">
                    Only the last four are
                    stored. The full number is
                    written on the printed copy.
                  </p>
                </div>

                <div className="field">
                  <label htmlFor="payment-holder">
                    Name on card
                  </label>

                  <input
                    id="payment-holder"
                    name="paymentCardHolder"
                    autoComplete="off"
                  />
                </div>
              </div>
            </fieldset>

            {/* --------------------- additional driver */}
            <fieldset className="field full checkout-block">
              <legend>
                Additional driver (optional)
              </legend>

              <div className="checkout-charges">
                {[
                  ["fullName", "Name"],
                  ["address", "Address"],
                  ["state", "State"],
                  ["dateOfBirth", "DOB"],
                  [
                    "licenceNumber",
                    "BVI license no.",
                  ],
                  [
                    "licenceExpiresAt",
                    "Expiration date",
                  ],
                  ["telephone", "Telephone"],
                  [
                    "localAddress",
                    "Local address",
                  ],
                ].map(([key, label]) => (
                  <div
                    className="field"
                    key={key}
                  >
                    <label
                      htmlFor={`driver-${key}`}
                    >
                      {label}
                    </label>

                    <input
                      id={`driver-${key}`}
                      value={
                        additionalDriver[
                          key as keyof typeof additionalDriver
                        ]
                      }
                      onChange={(event) =>
                        setAdditionalDriver(
                          (current) => ({
                            ...current,
                            [key]:
                              event.target
                                .value,
                          }),
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            </fieldset>

            <div className="field full">
              <MediaCapture
                stage="booking"
                value={checkoutMedia}
                onChange={setCheckoutMedia}
                label="Vehicle condition at checkout"
                hint="Capture the left, right, front and back of the vehicle with the renter present."
              />
            </div>

            <div className="field full">
              <div className="signature-mode">
                <button
                  type="button"
                  className={
                    signatureMode === "draw"
                      ? "button button-primary compact"
                      : "button button-secondary compact"
                  }
                  aria-pressed={
                    signatureMode === "draw"
                  }
                  onClick={() => {
                    setSignatureMode("draw");
                    setSignatureName("");
                  }}
                >
                  Sign on device
                </button>

                <button
                  type="button"
                  className={
                    signatureMode === "type"
                      ? "button button-primary compact"
                      : "button button-secondary compact"
                  }
                  aria-pressed={
                    signatureMode === "type"
                  }
                  onClick={() => {
                    setSignatureMode("type");
                    setCustomerSignature(null);
                  }}
                >
                  Type the name
                </button>
              </div>

              {signatureMode === "draw" ? (
                <CustomerSignaturePad
                  value={customerSignature}
                  onChange={
                    setCustomerSignature
                  }
                  disabled={busy}
                />
              ) : (
                <div className="field">
                  <label htmlFor="signature-name">
                    Renter name as accepted
                  </label>

                  <input
                    id="signature-name"
                    value={signatureName}
                    maxLength={120}
                    disabled={busy}
                    onChange={(event) =>
                      setSignatureName(
                        event.target.value,
                      )
                    }
                  />

                  <p className="form-help">
                    Recorded on the agreement in
                    place of a drawn signature.
                  </p>
                </div>
              )}
            </div>

            <div className="form-actions">
              <button
                className="button button-primary"
                disabled={
                  busy ||
                  !reservations.length ||
                  !(
                    customerSignature ||
                    signatureName.trim()
                  )
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
              <label htmlFor="active-rental">
                Active rental
              </label>

              <select
                id="active-rental"
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
              <label htmlFor="new-expected-return">
                New expected return
              </label>

              <input
                id="new-expected-return"
                name="expectedReturnAt"
                type="datetime-local"
                min={todayDateTime()}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="extension-note">
                Extension note
              </label>

              <input
                id="extension-note"
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
              <label htmlFor="active-rental-2">
                Active rental
              </label>

              <select
                id="active-rental-2"
                name="rentalId"
                required
                value={returnRentalId}
                onChange={(event) =>
                  setReturnRentalId(
                    event.target.value,
                  )
                }
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
              <label htmlFor="return-time">
                Return time
              </label>

              <input
                id="return-time"
                name="actualReturnAt"
                type="datetime-local"
                defaultValue={todayDateTime()}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="return-odometer">
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
                  id="return-odometer"
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
              <label htmlFor="return-fuel">
                Return fuel
              </label>

              <select
                id="return-fuel"
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

            {/* ------------------ charges raised at return */}
            <fieldset className="field full checkout-block">
              <legend>
                Due at return
              </legend>

              <p className="form-help">
                What the renter owes now the
                vehicle is back: an extension,
                cleaning or detailing,
                refuelling, damage and
                anything else. Leave a row
                empty and it is not charged. A
                discount is taken off the
                balance.
              </p>

              <div className="checkout-charges">
                {returnAdjustmentOptions.map(
                  (option) => (
                    <div
                      className="field"
                      key={option.type}
                    >
                      <label
                        htmlFor={`return-${option.type}`}
                      >
                        {option.label}
                        {" (USD)"}
                      </label>

                      <input
                        id={`return-${option.type}`}
                        type="number"
                        min="0.01"
                        max="100000"
                        step="0.01"
                        inputMode="decimal"
                        value={
                          returnAdjustments[
                            option.type
                          ] ?? ""
                        }
                        onChange={(event) =>
                          setReturnAdjustments(
                            (current) => ({
                              ...current,

                              [option.type]:
                                event.target
                                  .value,
                            }),
                          )
                        }
                      />

                      <input
                        aria-label={`${option.label} note`}
                        placeholder="Note (optional)"
                        maxLength={500}
                        value={
                          returnAdjustmentNotes[
                            option.type
                          ] ?? ""
                        }
                        onChange={(event) =>
                          setReturnAdjustmentNotes(
                            (current) => ({
                              ...current,

                              [option.type]:
                                event.target
                                  .value,
                            }),
                          )
                        }
                      />
                    </div>
                  ),
                )}
              </div>

              <div className="payment-due">
                <dl>
                  {returnRental &&
                    returnRental.depositCents >
                      0 && (
                      <div>
                        <dt>
                          Deposit held at
                          checkout
                        </dt>
                        <dd>
                          {formatMoney(
                            returnRental.depositCents,
                          )}
                        </dd>
                      </div>
                    )}

                  <div className="payment-due-total">
                    <dt>
                      Charges raised at return
                    </dt>
                    <dd>
                      {formatMoney(
                        returnAdjustmentTotalCents,
                      )}
                    </dd>
                  </div>
                </dl>

                {returnRental &&
                  returnRental.depositCents >
                    0 && (
                    <p className="form-help">
                      The deposit is refundable
                      and is not part of the
                      balance. Return it, or
                      settle the charges above
                      against it, at the
                      counter.
                    </p>
                  )}
              </div>
            </fieldset>

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
              <label htmlFor="return-note">
                Return note
              </label>

              <textarea
                id="return-note"
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
              <label htmlFor="rental">
                Rental
              </label>

              <select
                id="rental"
                name="rentalId"
                required
                value={paymentRentalId}
                onChange={(event) =>
                  setPaymentRentalId(
                    event.target.value,
                  )
                }
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
              <label htmlFor="amount-usd">
                Amount (USD)
              </label>

              <input
                id="amount-usd"
                name="amount"
                type="number"
                min="0.01"
                max="100000"
                step="0.01"
                inputMode="decimal"
                required
                value={paymentAmount}
                onChange={(event) =>
                  setPaymentAmount(
                    event.target.value,
                  )
                }
              />
            </div>

            <div className="field">
              <label htmlFor="method">
                Method
              </label>

              <select
                      id="method" name="method">
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

            {/*
              * Grouped by the end of the hire each fee
              * belongs to, so the desk can see at a glance
              * what should already have been taken at the
              * counter and what is only owed now the vehicle
              * is back. Both groups stay usable: a fee that
              * was missed at checkout is still collectable.
              */}
            {PAYMENT_FEE_STAGES.map((stage) => (
              <fieldset
                className="field full checkout-block"
                key={stage.id}
              >
                <legend>
                  {stage.heading}
                </legend>

                <p className="form-help">
                  {stage.hint}
                </p>

                <div className="checkout-charges">
                  {paymentFeeOptions
                    .filter(
                      (fee) =>
                        fee.stage === stage.id,
                    )
                    .map((fee) => (
                      <div
                        className="field"
                        key={fee.type}
                      >
                        <label>
                          <input
                            name={
                              fee.selectedName
                            }
                            type="checkbox"
                            checked={
                              selectedFees[
                                fee.type
                              ] ?? false
                            }
                            onChange={(
                              event,
                            ) =>
                              setSelectedFees(
                                (current) => ({
                                  ...current,

                                  [fee.type]:
                                    event
                                      .target
                                      .checked,
                                }),
                              )
                            }
                          />{" "}
                          {fee.label}
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
                          value={
                            feeAmounts[
                              fee.type
                            ] ?? ""
                          }
                          onChange={(event) =>
                            setFeeAmounts(
                              (current) => ({
                                ...current,

                                [fee.type]:
                                  event.target
                                    .value,
                              }),
                            )
                          }
                        />
                      </div>
                    ))}
                </div>
              </fieldset>
            ))}

            {/*
              * The running total, so the employee can read the
              * amount due to the customer off the screen while
              * the fees are still being typed rather than
              * after the payment has been taken.
              */}
            {selectedPayableRental && (
              <div className="field full payment-due">
                <dl>
                  <div>
                    <dt>
                      Outstanding before fees
                    </dt>
                    <dd>
                      {formatMoney(
                        selectedPayableRental.outstandingCents,
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt>Additional fees</dt>
                    <dd>
                      {formatMoney(
                        additionalFeesCents,
                      )}
                    </dd>
                  </div>

                  <div className="payment-due-total">
                    <dt>Total due</dt>
                    <dd>
                      {formatMoney(
                        totalDueCents,
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Balance after this payment
                    </dt>
                    <dd>
                      {formatMoney(
                        balanceAfterPayment,
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            <div className="field full">
              <label htmlFor="reference">
                Reference
              </label>

              <input
                id="reference"
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
      )}
    </AppShell>
  );
}