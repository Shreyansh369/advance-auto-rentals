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
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  FileText,
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
import { useFirebaseAuth } from "./firebase-provider";

import { CancelledBookings } from "./cancelled-bookings";
import { CountrySelect } from "./country-select";
import { CustomerLicenseCapture } from "./customer-license-capture";
import { MediaCapture } from "./media-capture";
import { CustomerSignaturePad } from "./customer-signature-pad";
import { DamageDiagram } from "./damage-diagram";
import { RentalAgreement } from "./rental-agreement";
import {
  DailyRateDiscountField,
  EMPTY_DAILY_RATE_DISCOUNT,
  dailyRateDiscountPayload,
  previewDailyRateDiscount,
  type DailyRateDiscountDraft,
} from "./daily-rate-discount";

import { getFirebaseClient } from "@/lib/firebase/client";

import {
  firebaseErrorMessage,
  formatDate,
  formatFuel,
  formatMoney,
} from "@/lib/presentation";

import type { CloudinaryMedia } from "@/lib/cloudinary";

import {
  sanitizeDamageMarks,
  summariseDamage,
  type DamageMark,
} from "@/lib/damage";

import {
  AGREEMENT_RATES,
  CHARGE_ROWS,
  PAYMENT_METHODS,
  type AgreementPaymentMethod,
} from "@/lib/agreement";

import {
  callFirestoreOperation,
  type AdditionalFeeType,
  type CancellationRequest,
  type ContractQueueEntry,
  type PayableRental,
  type RentalDiscount,
  type ReturnRequest,
  describeDailyRateDiscount,
} from "@/lib/services/firestore-client";

import { rentOwedThrough } from "@/packages/domain/src/pricing";

import type { VehicleRates } from "@/packages/domain/src/types";

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
  /* The damage it carries from its last hire. */
  damageMarks: DamageMark[];
  /* Its own rates, which a booking discount never changes. */
  rates: VehicleRates | null;
};

type Reservation = {
  id: string;
  vehicleId: string;
  customerName: string;
  vehicleRegistration: string;
  pickupAt: string | null;
  expectedReturnAt: string | null;
  /* Written down after the pickup it records had passed. */
  backdated: boolean;
  /* The cancellation it is waiting on, or was last refused. */
  cancellationRequestStatus: string | null;
  /* The booking's own rates, and its daily-rate discount. */
  rates: VehicleRates | null;
  dailyRateDiscountId: string | null;
  dailyRateDiscountStatus: string | null;
  /* Extended prices for the agreement's charges table:
     units booked multiplied by the rate quoted at booking. */
  dailyCents: number;
  weeklyCents: number;
  monthlyCents: number;
};

type Rental = {
  id: string;
  customerName: string;
  /* Marked on the drawings when it went out. */
  checkoutDamageMarks: DamageMark[];
  vehicleRegistration: string;
  pickupOdometerKm: number;
  expectedReturnAt: string | null;
  createdByNameSnapshot: string | null;
  checkedOutByNameSnapshot: string | null;
  /** Taken at the counter and owed back at return. */
  depositCents: number;
  status: string;
  /*
   * The earliest a return can be dated: the booked pickup, or
   * the checkout if the vehicle was collected before it.
   */
  returnFloorAt: string | null;
  /* A backdated return waiting on, or last refused by, an administrator. */
  returnRequestStatus: string | null;
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

/*
 * What the renter settles at each end of the hire.
 *
 * At the counter they pay the deposit, the insurance, the car
 * seats and the rental days themselves. The hours run over,
 * the waivers taken, the fuel and the detailing cannot be
 * known until the car comes back, so none of them is on the
 * checkout form: they are raised at return.
 *
 * Daily, weekly and monthly are not entered by hand anywhere
 * — they restate the booking's own quote.
 */
const CHECKOUT_CHARGE_KEYS = [
  "insurance",
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
    type: "extra_hours",
    label: "Extra hours",
  },
  {
    type: "liability_waiver",
    label: "Liability waiver",
  },
  {
    type: "windscreen_waiver",
    label: "Windscreen waiver",
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
  },
  {
    id: "return",
    heading: "Collected at return",
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

/* Stored rates in cents, or null where a rate is not set. */
function ratesFrom(
  value: unknown,
): VehicleRates | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rates = value as Record<string, unknown>;

  const cents = (field: string) => {
    const amount = Number(rates[field]);

    return rates[field] == null ||
      !Number.isSafeInteger(amount) ||
      amount < 0
      ? null
      : amount;
  };

  return {
    currency: "USD",
    dailyCents: cents("dailyCents"),
    weeklyCents: cents("weeklyCents"),
    monthlyCents: cents("monthlyCents"),
  };
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

/* An instant as a datetime-local value, rounded up to the minute. */
function localInputValue(
  iso: string | null,
): string | undefined {
  if (!iso) {
    return undefined;
  }

  const value = new Date(
    Math.ceil(Date.parse(iso) / 60_000) *
      60_000,
  );

  if (Number.isNaN(value.valueOf())) {
    return undefined;
  }

  value.setMinutes(
    value.getMinutes() -
      value.getTimezoneOffset(),
  );

  return value.toISOString().slice(0, 16);
}

/*
 * A return dated more than fifteen minutes before it is entered
 * is backdated: it needs a reason, and an administrator's
 * approval unless an administrator enters it.
 */
const BACKDATED_RETURN_MS = 15 * 60_000;

function isBackdatedReturn(
  localValue: string | null,
): boolean {
  if (!localValue) {
    return false;
  }

  const at = new Date(localValue).getTime();

  return (
    Number.isFinite(at) &&
    at < Date.now() - BACKDATED_RETURN_MS
  );
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

  /*
   * The booking being written down is one the office already
   * started: the car went out before this system had the
   * record, and it has not come back. Held in state rather
   * than read off the form because the pickup and return
   * inputs change the range they accept with it.
   */
  const [backdated, setBackdated] =
    useState(false);

  const [rentals, setRentals] =
    useState<Rental[]>([]);

  /* Who may discount outright and who has to ask. */
  const { role } = useFirebaseAuth();

  const isAdmin = role === "admin";

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

  /*
   * How far the rent is charged with this payment. A long
   * hire runs past the date its rent was charged to, so the
   * rental is re-priced to this date, the way an extension
   * is, before the payment is taken.
   */
  const [chargeThrough, setChargeThrough] =
    useState("");

  const [pendingDiscounts, setPendingDiscounts] =
    useState<RentalDiscount[]>([]);

  const [reviewNotes, setReviewNotes] = useState<
    Record<string, string>
  >({});

  /* Cancelling frees the vehicle, so it asks twice. */
  const [cancellingId, setCancellingId] =
    useState<string | null>(null);

  const [cancelReason, setCancelReason] =
    useState("");

  const [cancelBusy, setCancelBusy] =
    useState(false);

  /*
   * Cancellations asked for by anyone other than an
   * administrator wait for one. Every waiting request is
   * listed, plus this person's own, so a rejection reaches
   * whoever asked.
   */
  const [
    cancellationRequests,
    setCancellationRequests,
  ] = useState<CancellationRequest[]>([]);

  const [
    cancellationNotes,
    setCancellationNotes,
  ] = useState<Record<string, string>>({});

  /*
   * Backdated returns waiting for an administrator, and this
   * person's own, so a rejection reaches whoever asked.
   */
  const [returnRequests, setReturnRequests] =
    useState<ReturnRequest[]>([]);

  const [
    returnRequestNotes,
    setReturnRequestNotes,
  ] = useState<Record<string, string>>({});

  /*
   * The return time once it has been changed from the default
   * of now, which is what decides whether it is backdated.
   */
  const [returnTimeEdited, setReturnTimeEdited] =
    useState<string | null>(null);

  const [backdatedReason, setBackdatedReason] =
    useState("");

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
   * The damage marked on the drawings. Null until the form is
   * touched, so it follows whichever booking or rental is
   * selected: checkout starts from the damage the vehicle
   * already carries, return from what it went out with.
   */
  const [checkoutDamage, setCheckoutDamage] =
    useState<DamageMark[] | null>(null);

  const [returnDamage, setReturnDamage] =
    useState<DamageMark[] | null>(null);

  /*
   * A discount on the daily rate offered at the counter, and
   * the money taken there. Whatever is not paid now is left as
   * the rental's balance due.
   */
  const [checkoutRateDiscount, setCheckoutRateDiscount] =
    useState<DailyRateDiscountDraft>(
      EMPTY_DAILY_RATE_DISCOUNT,
    );

  /*
   * The same discount asked for on the booking, and what it is
   * priced against: held in state so the totals follow the
   * vehicle and the dates as they are chosen.
   */
  const [bookingRateDiscount, setBookingRateDiscount] =
    useState<DailyRateDiscountDraft>(
      EMPTY_DAILY_RATE_DISCOUNT,
    );

  const [bookingVehicleId, setBookingVehicleId] =
    useState("");

  const [bookingPickupAt, setBookingPickupAt] =
    useState("");

  const [bookingReturnAt, setBookingReturnAt] =
    useState("");

  const [checkoutPaidNow, setCheckoutPaidNow] =
    useState("");

  /*
   * The charge rows the employee fills in. The daily, weekly
   * and monthly rows restate the booking's quote and are not
   * entered here, so they are left out of this list.
   */
  const [agreementCharges, setAgreementCharges] =
    useState<Record<string, string>>({
      insurance: "",
      carSeat: "",
      other: "",
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

  /*
   * The waivers taken and the hours run over are known when
   * the vehicle comes back, not when it goes out, so they are
   * collected at return and merged into the stored agreement.
   */
  const [waivers, setWaivers] = useState({
    liabilityWaiver: false,
    windscreenWaiver: false,
    personalAccidentInsurance: false,
  });

  const [returnExtraHours, setReturnExtraHours] =
    useState("0");

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
   * The directory grows without limit, and a list of every
   * matching name pushed the rest of the booking form off the
   * screen. The picker is a dropdown instead: closed it is one
   * row, open it is a search box over the same list.
   */
  const [customerPickerOpen, setCustomerPickerOpen] =
    useState(false);

  const customerPickerRef =
    useRef<HTMLDivElement | null>(null);

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
    if (!customerPickerOpen) {
      return;
    }

    function onPointerDown(
      event: PointerEvent,
    ) {
      if (
        customerPickerRef.current &&
        !customerPickerRef.current.contains(
          event.target as Node,
        )
      ) {
        setCustomerPickerOpen(false);
      }
    }

    function onKeyDown(
      event: KeyboardEvent,
    ) {
      if (event.key === "Escape") {
        setCustomerPickerOpen(false);
      }
    }

    document.addEventListener(
      "pointerdown",
      onPointerDown,
    );

    document.addEventListener(
      "keydown",
      onKeyDown,
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        onPointerDown,
      );

      document.removeEventListener(
        "keydown",
        onKeyDown,
      );
    };
  }, [customerPickerOpen]);

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
              damageMarks:
                sanitizeDamageMarks(
                  snapshot.get(
                    "damageMarks",
                  ),
                ),
              rates: ratesFrom(
                snapshot.get("rates"),
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
            vehicleId: String(
              snapshot.get(
                "vehicleId",
              ) ?? "",
            ),
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
            backdated:
              snapshot.get(
                "backdated",
              ) === true,
            cancellationRequestStatus:
              snapshot.get(
                "cancellationRequestStatus",
              ) ?? null,
            rates: ratesFrom(
              snapshot.get("rateSnapshot"),
            ),
            dailyRateDiscountId:
              snapshot.get(
                "dailyRateDiscountId",
              ) ?? null,
            dailyRateDiscountStatus:
              snapshot.get(
                "dailyRateDiscountStatus",
              ) ?? null,
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
            checkoutDamageMarks:
              sanitizeDamageMarks(
                snapshot.get(
                  "checkoutDamageMarks",
                ),
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
            returnFloorAt: (() => {
              const pickup = toDateTimeInput(
                snapshot.get("pickupAt"),
              );

              const checkedOut =
                toDateTimeInput(
                  snapshot.get("createdAt"),
                );

              return pickup && checkedOut
                ? new Date(
                    Math.min(
                      Date.parse(pickup),
                      Date.parse(checkedOut),
                    ),
                  ).toISOString()
                : pickup ?? checkedOut;
            })(),
            returnRequestStatus:
              snapshot.get(
                "returnRequestStatus",
              ) ?? null,
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

      const discounts =
        await callFirestoreOperation<
          Record<string, never>,
          RentalDiscount[]
        >(
          "listPendingDiscounts",
          {},
        );

      if (isCancelled()) {
        return;
      }

      setPayableRentals(
        records,
      );

      setPendingDiscounts(
        discounts,
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

  /*
   * Read on its own, like the contract queue, so rules that
   * have not been deployed yet cost this panel and nothing
   * else on the desk.
   */
  async function loadCancellationRequests() {
    try {
      setCancellationRequests(
        await callFirestoreOperation<
          undefined,
          CancellationRequest[]
        >(
          "listCancellationRequests",
          undefined,
        ),
      );
    } catch (cause) {
      console.error(
        "[ReservationComposer] loadCancellationRequests failed:",
        cause,
      );

      setCancellationRequests([]);
    }
  }

  async function loadReturnRequests() {
    try {
      setReturnRequests(
        await callFirestoreOperation<
          undefined,
          ReturnRequest[]
        >("listReturnRequests", undefined),
      );
    } catch (cause) {
      console.error(
        "[ReservationComposer] loadReturnRequests failed:",
        cause,
      );

      setReturnRequests([]);
    }
  }

  useEffect(() => {
    const timer =
      window.setTimeout(
        () => {
          void load();
          void loadPayableRentals();
          void loadContractQueue();
          void loadCancellationRequests();
          void loadReturnRequests();
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
      await loadCancellationRequests();
      await loadReturnRequests();
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

  function centsFromDollars(value: string): number {
    const amount = Number(value || 0);

    return Number.isFinite(amount) && amount > 0
      ? Math.round(amount * 100)
      : 0;
  }

  /*
   * What a discount on the daily rate takes off the rental
   * days, priced the way the checkout will price it: the
   * booking's own rates and dates, the cheapest mix re-run.
   */
  const checkoutPeriod =
    checkoutReservationQuote?.pickupAt &&
    checkoutReservationQuote.expectedReturnAt
      ? {
          pickupAt:
            checkoutReservationQuote.pickupAt,
          expectedReturnAt:
            checkoutReservationQuote.expectedReturnAt,
        }
      : null;

  const checkoutDiscountPreview =
    previewDailyRateDiscount(
      checkoutRateDiscount,
      checkoutReservationQuote?.rates ?? null,
      checkoutPeriod,
    );

  const checkoutDiscountCents =
    checkoutDiscountPreview.discountedTotalCents !==
      null &&
    checkoutDiscountPreview.fullTotalCents !== null
      ? Math.max(
          0,
          checkoutDiscountPreview.fullTotalCents -
            checkoutDiscountPreview.discountedTotalCents,
        )
      : 0;

  /*
   * An administrator's discount comes straight off; anyone
   * else's waits for an administrator, so it is shown but not
   * taken off what is collected now.
   */
  const checkoutDiscountAppliedCents = isAdmin
    ? checkoutDiscountCents
    : 0;

  /*
   * The booking tab prices the discount against the chosen
   * vehicle's own rates and the dates as typed.
   */
  const bookingRates =
    vehicles.find(
      (vehicle) =>
        vehicle.id === bookingVehicleId,
    )?.rates ?? null;

  const bookingPeriod =
    bookingPickupAt && bookingReturnAt
      ? (() => {
          try {
            return {
              pickupAt: localToIso(
                bookingPickupAt,
              ),
              expectedReturnAt: localToIso(
                bookingReturnAt,
              ),
            };
          } catch {
            return null;
          }
        })()
      : null;

  const bookingDiscountPreview =
    previewDailyRateDiscount(
      bookingRateDiscount,
      bookingRates,
      bookingPeriod,
    );

  /* The booking's own discount, already asked for or applied. */
  const checkoutBookingDiscount =
    checkoutReservationQuote?.dailyRateDiscountStatus ===
      "pending" ||
    checkoutReservationQuote?.dailyRateDiscountStatus ===
      "approved"
      ? checkoutReservationQuote.dailyRateDiscountStatus
      : null;

  const dueAtCheckoutCents =
    agreementTotalCents -
    checkoutDiscountAppliedCents +
    checkoutDepositCents;

  /* The rental's share of what is due, deposit aside. */
  const checkoutRentalDueCents = Math.max(
    agreementTotalCents - checkoutDiscountCents,
    0,
  );

  const checkoutPaidNowCents =
    centsFromDollars(checkoutPaidNow);

  const balanceAfterCheckoutCents = Math.max(
    agreementTotalCents -
      checkoutDiscountAppliedCents -
      checkoutPaidNowCents,
    0,
  );

  /*
   * Checkout starts from the damage the vehicle already
   * carries; return from the damage it went out with.
   */
  const checkoutDamageBaseline =
    vehicles.find(
      (vehicle) =>
        vehicle.id ===
        checkoutReservationQuote?.vehicleId,
    )?.damageMarks ?? [];

  const checkoutDamageMarks =
    checkoutDamage ?? checkoutDamageBaseline;

  const returnDamageBaseline =
    rentals.find(
      (rental) => rental.id === returnRentalId,
    )?.checkoutDamageMarks ?? [];

  const returnDamageMarks =
    returnDamage ?? returnDamageBaseline;

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

        return sum + cents;
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

  /*
   * Rent for the time the vehicle has been out past the date
   * it was charged to. Priced from the rental's own rates, so
   * the figure on screen is what the extension will charge.
   */
  const rentChargeCents = (() => {
    if (
      !selectedPayableRental?.pickupAt ||
      !selectedPayableRental.paidThroughAt ||
      !selectedPayableRental.rates ||
      !chargeThrough
    ) {
      return 0;
    }

    try {
      return rentOwedThrough(
        {
          pickupAt:
            selectedPayableRental.pickupAt,
          chargedThroughAt:
            selectedPayableRental.paidThroughAt,
          throughAt: localToIso(chargeThrough),
          baseRentalCents:
            selectedPayableRental.baseRentalCents,
        },
        selectedPayableRental.rates,
      );
    } catch {
      return 0;
    }
  })();

  const rentIsOverdue =
    selectedPayableRental?.rentOverdue ?? false;

  const pendingDiscountForRental =
    pendingDiscounts.find(
      (discount) =>
        discount.rentalId === paymentRentalId,
    );

  const totalDueCents =
    (selectedPayableRental?.outstandingCents ??
      0) +
    rentChargeCents +
    additionalFeesCents;

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
    setError(undefined);
    setNotice(undefined);

    /*
     * Every cancellation is listed with its reason, so a
     * booking cannot be released without one.
     */
    if (!cancelReason.trim()) {
      setError(
        "Give a reason for cancelling this booking.",
      );

      return;
    }

    setCancelBusy(true);

    try {
      const result =
        await callFirestoreOperation<
          {
            reservationId: string;
            reason: string;
          },
          {
            reservationId: string;
            vehicleReleased: boolean;
            status: "cancelled" | "pending";
          }
        >("cancelReservation", {
          reservationId: reservation.id,
          reason: cancelReason.trim(),
        });

      setCancellingId(null);
      setCancelReason("");

      await load();
      await loadCancellationRequests();

      setNotice(
        result.status === "pending"
          ? `Cancellation of ${reservation.vehicleRegistration} sent to an administrator for approval. The booking stays reserved until then.`
          : result.vehicleReleased
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

  function decideCancellation(
    request: CancellationRequest,
    decision: "approve" | "reject",
  ) {
    void run(async () => {
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
          requestId: request.id,
          decision,
          note:
            cancellationNotes[request.id]?.trim() ||
            null,
        });

      setCancellationNotes((current) => {
        const next = { ...current };

        delete next[request.id];

        return next;
      });

      return result.status === "approved"
        ? `Cancellation approved · ${request.vehicleRegistration} booking cancelled${
            result.vehicleReleased
              ? " and the vehicle is available again"
              : ""
          }.`
        : `Cancellation of ${request.vehicleRegistration} rejected · the booking stays active.`;
    });
  }

  /* The request a booking is waiting on, if any. */
  function waitingCancellation(
    reservationId: string,
  ): CancellationRequest | undefined {
    return cancellationRequests.find(
      (request) =>
        request.reservationId ===
          reservationId &&
        request.status === "pending",
    );
  }

  /*
   * The most recent refusal of a cancellation this person asked
   * for, while the booking is still live and nothing newer is
   * waiting.
   */
  function rejectedCancellation(
    reservation: Reservation,
  ): CancellationRequest | undefined {
    if (
      reservation.cancellationRequestStatus !==
      "rejected"
    ) {
      return undefined;
    }

    return cancellationRequests.find(
      (request) =>
        request.reservationId ===
          reservation.id &&
        request.status === "rejected",
    );
  }

  const waitingCancellations =
    cancellationRequests.filter(
      (request) =>
        request.status === "pending",
    );

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

    const bookingDiscount =
      dailyRateDiscountPayload(
        bookingRateDiscount,
      );

    void run(
      async () => {
        if (
          bookingDiscount &&
          !bookingDiscount.reason
        ) {
          throw new Error(
            "Say why the discount is being offered.",
          );
        }

        if (
          bookingDiscount &&
          bookingDiscountPreview.error
        ) {
          throw new Error(
            bookingDiscountPreview.error,
          );
        }

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
              backdated: boolean;
              dailyRateDiscount: {
                type: "amount" | "percent";
                value: number;
                reason: string;
              } | null;
            },
            {
              reservationId: string;
              quote: {
                baseRentalCents: number;
                chargedDays: number;
              };
              discountStatus:
                | "approved"
                | "pending"
                | null;
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

              backdated,

              dailyRateDiscount: bookingDiscount,
            },
          );

        formElement.reset();

        setBookingRateDiscount(
          EMPTY_DAILY_RATE_DISCOUNT,
        );
        setBookingVehicleId("");
        setBookingPickupAt("");
        setBookingReturnAt("");

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

        /* reset() cannot clear a controlled checkbox, and the
           next booking is an ordinary one until it says
           otherwise. */
        const wasBackdated = backdated;

        setBackdated(false);

        const discountNote =
          result.discountStatus === "pending"
            ? " · daily-rate discount waiting for an administrator, charged at the full rate until then"
            : result.discountStatus === "approved"
              ? " · daily-rate discount applied"
              : "";

        return `${
          wasBackdated
            ? "Backdated booking recorded"
            : "Booking confirmed"
        } · ${result.quote.chargedDays} day(s) · ${formatMoney(
          result.quote.baseRentalCents,
        )}${discountNote}. Check the vehicle out to sign and issue the rental agreement.`;
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
        const rateDiscount =
          dailyRateDiscountPayload(
            checkoutRateDiscount,
          );

        if (rateDiscount && !rateDiscount.reason) {
          throw new Error(
            "Say why the discount is being offered.",
          );
        }

        if (
          rateDiscount &&
          checkoutDiscountPreview.error
        ) {
          throw new Error(
            checkoutDiscountPreview.error,
          );
        }

        if (
          checkoutPaidNowCents > 0 &&
          !paymentMethod
        ) {
          throw new Error(
            "Choose how the renter is paying — cash, check, credit card, credit or ATH — before recording the amount paid now.",
          );
        }

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
              damageMarks: DamageMark[];
              dailyRateDiscount: {
                type: "amount" | "percent";
                value: number;
                reason: string;
              } | null;
              paidNowCents: number;
            },
            {
              rentalId: string;
              outstandingCents: number;
              discountStatus:
                | "approved"
                | "pending"
                | null;
              paidNowCents: number;
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

              waivers: {},

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

              extraHours: 0,

              damageMarks:
                checkoutDamageMarks,

              dailyRateDiscount: rateDiscount,

              paidNowCents:
                checkoutPaidNowCents,
            },
          );

        formElement.reset();

        setCheckoutReservationId("");
        setCheckoutMedia([]);
        setCheckoutDamage(null);
        setCheckoutRateDiscount(
          EMPTY_DAILY_RATE_DISCOUNT,
        );
        setCheckoutPaidNow("");
        setCustomerSignature(null);
        setSignatureName("");
        setPaymentMethod("");

        setDepositAmount(
          (
            AGREEMENT_RATES.depositCents / 100
          ).toFixed(2),
        );

        setAgreementCharges({
          insurance: "",
          carSeat: "",
          other: "",
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

        const paidNote =
          result.paidNowCents > 0
            ? ` · ${formatMoney(
                result.paidNowCents,
              )} paid`
            : "";

        const balanceNote =
          result.outstandingCents > 0
            ? ` · ${formatMoney(
                result.outstandingCents,
              )} balance due on the Payment tab`
            : " · nothing left to pay";

        const discountNote =
          result.discountStatus === "pending"
            ? " · discount waiting for an administrator"
            : result.discountStatus === "approved"
              ? " · discount applied"
              : "";

        return `Vehicle checked out${paidNote}${balanceNote}${discountNote} · rental agreement ready to print.`;
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

    const returnIsBackdated =
      isBackdatedReturn(
        String(
          form.get("actualReturnAt") ?? "",
        ),
      );

    void run(
      async () => {
        if (
          returnIsBackdated &&
          !backdatedReason.trim()
        ) {
          throw new Error(
            "Say why the return is being recorded at an earlier time.",
          );
        }

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
              } | null;
              adjustments: Array<{
                type: string;
                amountCents: number;
                note: string;
              }>;
              waivers: Record<
                string,
                boolean
              >;
              extraHours: number;
              notes:
                | string
                | null;
              returnMedia: CloudinaryMedia[];
              damageMarks: DamageMark[];
              reason: string | null;
            },
            {
              outstandingCents: number;
              status: "returned" | "pending";
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

              /* Optional: a blank is sent as no reading. */
              returnOdometer: String(
                form.get(
                  "returnOdometerValue",
                ) ?? "",
              ).trim()
                ? {
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
                  }
                : null,

              adjustments,

              waivers,

              extraHours: Number(
                returnExtraHours || 0,
              ),

              notes:
                String(
                  form.get(
                    "notes",
                  ),
                ).trim() ||
                null,

              returnMedia,

              damageMarks:
                returnDamageMarks,

              reason: returnIsBackdated
                ? backdatedReason.trim()
                : null,
            },
          );

        const newDamage =
          returnDamageMarks.filter(
            (mark) =>
              !returnDamageBaseline.some(
                (existing) =>
                  existing.id === mark.id,
              ),
          );

        formElement.reset();

        setReturnMedia(
          [],
        );

        setReturnDamage(null);

        setReturnRentalId("");
        setReturnAdjustments({});
        setReturnAdjustmentNotes({});
        setReturnExtraHours("0");
        setReturnTimeEdited(null);
        setBackdatedReason("");

        setWaivers({
          liabilityWaiver: false,
          windscreenWaiver: false,
          personalAccidentInsurance: false,
        });

        /*
         * A return that leaves a balance goes straight to the
         * payment tab with the rental already chosen, so the
         * desk can settle it while the customer is still at
         * the counter.
         */
        const damageNote =
          newDamage.length > 0
            ? ` New damage marked: ${summariseDamage(
                newDamage,
              )}.`
            : "";

        /*
         * Held for an administrator: the rental stays open and
         * the vehicle stays rented until it is decided.
         */
        if (result.status === "pending") {
          return "Backdated return sent to an administrator for approval. The rental stays open until it is decided.";
        }

        if (result.outstandingCents > 0) {
          setPaymentRentalId(returnedRentalId);

          setTab("payment");

          return `Return completed · ${formatMoney(
            result.outstandingCents,
          )} outstanding. Take the payment below.${damageNote}`;
        }

        return `Return completed · nothing left to pay.${damageNote}`;
      },
    );
  }

  function decideReturn(
    request: ReturnRequest,
    decision: "approve" | "reject",
  ) {
    void run(async () => {
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
          requestId: request.id,
          decision,
          note:
            returnRequestNotes[request.id]?.trim() ||
            null,
        });

      setReturnRequestNotes((current) => {
        const next = { ...current };

        delete next[request.id];

        return next;
      });

      if (result.status !== "approved") {
        return `Backdated return for ${request.vehicleRegistration} rejected · the rental stays open.`;
      }

      /*
       * Exactly as a return at the counter: a balance left
       * over goes straight to the payment tab.
       */
      if ((result.outstandingCents ?? 0) > 0) {
        setPaymentRentalId(result.rentalId);

        setTab("payment");

        return `Backdated return approved · ${formatMoney(
          result.outstandingCents ?? 0,
        )} outstanding. Take the payment below.`;
      }

      return "Backdated return approved · nothing left to pay.";
    });
  }

  const waitingReturns = returnRequests.filter(
    (request) => request.status === "pending",
  );

  /* The latest refusal of a backdated return, while the rental is still out. */
  const rejectedReturn =
    returnRental?.returnRequestStatus ===
    "rejected"
      ? returnRequests.find(
          (request) =>
            request.rentalId === returnRental.id &&
            request.status === "rejected",
        )
      : undefined;

  const returnWaiting =
    returnRental?.returnRequestStatus ===
    "pending";

  const returnTimeBackdated =
    isBackdatedReturn(returnTimeEdited);

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

        const paymentRental = String(
          form.get("rentalId"),
        );

        /*
         * Rent past the charged date goes on the rental first,
         * as an extension, so the payment is taken against the
         * balance it creates. The extension keeps its own
         * idempotency key: if the payment then fails, a retry
         * does not charge the rent a second time.
         */
        if (chargeThrough && rentChargeCents > 0) {
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
          >("extendRental", {
            rentalId: paymentRental,
            expectedReturnAt:
              localToIso(chargeThrough),
            note: "Rent charged with payment",
            idempotencyKey: operationKey(
              `rent-${paymentRental}-${chargeThrough}`,
            ),
          });
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

        releaseOperationKey(
          `rent-${paymentRental}-${chargeThrough}`,
        );

        formElement.reset();

        /* reset() cannot clear controlled inputs. */
        setPaymentRentalId("");
        setPaymentAmount("");
        setChargeThrough("");
        setSelectedFees({});
        setFeeAmounts({});

        return `Payment recorded · outstanding balance ${formatMoney(
          result.outstandingCents,
        )}.`;
      },
    );
  }

  /*
   * When a rental is chosen, a hire that has run past the date
   * its rent was charged to is priced up to now, so the rent
   * that has built up is on screen without anyone asking.
   */
  function selectPaymentRental(
    rentalId: string,
  ) {
    setPaymentRentalId(rentalId);

    const rental = payableRentals.find(
      (entry) => entry.id === rentalId,
    );

    /*
     * A started day is charged as a whole one, so the rent is
     * charged to the end of the day the renter is in: that is
     * what they are paying for, and charging only to this
     * minute would show the hire overdue again straight away.
     */
    if (!rental?.rentOverdue || !rental.pickupAt) {
      setChargeThrough("");

      return;
    }

    const dayMs = 86_400_000;

    const pickupMs = Date.parse(rental.pickupAt);

    const through = new Date(
      pickupMs +
        Math.ceil((Date.now() - pickupMs) / dayMs) *
          dayMs,
    );

    through.setMinutes(
      through.getMinutes() -
        through.getTimezoneOffset(),
    );

    setChargeThrough(
      through.toISOString().slice(0, 16),
    );
  }

  function decideDiscount(
    discount: RentalDiscount,
    decision: "approve" | "reject",
  ) {
    void run(async () => {
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
          discountId: discount.id,
          decision,
          note:
            reviewNotes[discount.id]?.trim() ||
            null,
        });

      setReviewNotes((current) => {
        const next = { ...current };

        delete next[discount.id];

        return next;
      });

      return result.status === "approved"
        ? result.outstandingCents === null
          ? `Discount approved for ${discount.vehicleRegistration} · the booking is now priced at the discounted daily rate.`
          : `Discount approved for ${discount.vehicleRegistration} · ${formatMoney(
              result.outstandingCents,
            )} now outstanding.`
        : `Discount for ${discount.vehicleRegistration} rejected.`;
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
                    {/* Otherwise a pickup dated last month
                        reads as a typo rather than as the
                        hire the office caught up on. */}
                    {reservation.backdated && (
                      <span className="status-pill reserved">
                        Backdated
                      </span>
                    )}

                    {waitingCancellation(
                      reservation.id,
                    ) && (
                      <span className="status-pill cleaning">
                        Cancellation waiting for approval
                      </span>
                    )}

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

                      {(() => {
                        const rejected =
                          rejectedCancellation(
                            reservation,
                          );

                        return rejected ? (
                          <small>
                            Cancellation rejected
                            {rejected.reviewedByName
                              ? ` by ${rejected.reviewedByName}`
                              : ""}
                            {rejected.reviewNote
                              ? ` · “${rejected.reviewNote}”`
                              : ""}
                          </small>
                        ) : null;
                      })()}
                    </span>

                    {waitingCancellation(
                      reservation.id,
                    ) ? null : cancellingId ===
                    reservation.id ? (
                      <span className="booking-list-confirm">
                        <input
                          aria-label="Reason for cancelling"
                          placeholder="Reason (required)"
                          required
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
                          disabled={
                            cancelBusy ||
                            !cancelReason.trim()
                          }
                          onClick={() =>
                            void cancelBooking(
                              reservation,
                            )
                          }
                        >
                          {cancelBusy
                            ? "Cancelling…"
                            : isAdmin
                              ? "Yes, cancel"
                              : "Ask to cancel"}
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

      {/*
        * Cancellations asked for by staff, waiting for an
        * administrator. Nothing about the booking changes until
        * one is approved here.
        */}
      {tab === "booking" &&
        isAdmin &&
        waitingCancellations.length > 0 && (
          <section className="surface booking-list">
            <p className="section-kicker">
              Cancellations waiting for your
              approval
            </p>

            <ul>
              {waitingCancellations.map(
                (request) => (
                  <li key={request.id}>
                    <span className="booking-list-detail">
                      <strong>
                        {request.vehicleRegistration}
                        {" · "}
                        {request.customerName}
                      </strong>

                      <small>
                        {request.pickupAt
                          ? `${bookingMoment(
                              request.pickupAt,
                            )} → ${bookingMoment(
                              request.expectedReturnAt,
                            )} · `
                          : ""}
                        “{request.reason}”
                      </small>

                      <small>
                        Asked by{" "}
                        {request.requestedByName ||
                          "staff"}
                        {" · "}
                        {bookingMoment(
                          request.requestedAt,
                        )}
                      </small>
                    </span>

                    <span className="booking-list-confirm">
                      <input
                        aria-label="Decision note"
                        placeholder="Note (required to reject)"
                        maxLength={1000}
                        value={
                          cancellationNotes[
                            request.id
                          ] ?? ""
                        }
                        onChange={(event) =>
                          setCancellationNotes(
                            (current) => ({
                              ...current,
                              [request.id]:
                                event.target.value,
                            }),
                          )
                        }
                      />

                      <button
                        className="button button-danger compact"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          decideCancellation(
                            request,
                            "approve",
                          )
                        }
                      >
                        Approve
                      </button>

                      <button
                        className="button button-secondary compact"
                        type="button"
                        disabled={
                          busy ||
                          !cancellationNotes[
                            request.id
                          ]?.trim()
                        }
                        onClick={() =>
                          decideCancellation(
                            request,
                            "reject",
                          )
                        }
                      >
                        Reject
                      </button>
                    </span>
                  </li>
                ),
              )}
            </ul>
          </section>
        )}

      {tab === "booking" && (
        <CancelledBookings />
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

                            setCustomerSearch(
                              "",
                            );

                            setCustomerPickerOpen(
                              true,
                            );
                          }}
                        >
                          Change
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="customer-combobox"
                      ref={customerPickerRef}
                    >
                      <button
                        id="customer"
                        type="button"
                        className="customer-combobox-trigger"
                        aria-haspopup="listbox"
                        aria-expanded={
                          customerPickerOpen
                        }
                        onClick={() =>
                          setCustomerPickerOpen(
                            (open) => !open,
                          )
                        }
                      >
                        <span className="selected-customer-icon">
                          <UserRound
                            size={17}
                          />
                        </span>

                        <span>
                          <strong>
                            Select a customer
                          </strong>

                          <small>
                            {customers.length ===
                            1
                              ? "1 customer on file"
                              : `${customers.length} customers on file`}
                          </small>
                        </span>

                        <ChevronDown
                          size={16}
                        />
                      </button>

                      {customerPickerOpen && (
                        <div className="customer-combobox-panel">
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
                              autoFocus
                              defaultValue={
                                customerSearch
                              }
                              onChange={(
                                event,
                              ) =>
                                setCustomerSearch(
                                  event.target
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
                                <X
                                  size={15}
                                />
                              </button>
                            )}
                          </div>

                          <div
                            className="customer-choice-list"
                            role="listbox"
                            aria-label="Customers"
                          >
                            {filteredCustomers
                              .slice(0, 50)
                              .map(
                                (customer) => (
                                  <button
                                    className="customer-choice"
                                    key={
                                      customer.id
                                    }
                                    type="button"
                                    role="option"
                                    aria-selected={
                                      false
                                    }
                                    onClick={() => {
                                      setSelectedCustomerId(
                                        customer.id,
                                      );

                                      setCustomerPickerOpen(
                                        false,
                                      );
                                    }}
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

                            {filteredCustomers.length >
                              50 && (
                              <p className="customer-picker-more">
                                Showing the
                                first 50 of{" "}
                                {
                                  filteredCustomers.length
                                }
                                . Keep typing to
                                narrow the list.
                              </p>
                            )}

                            {filteredCustomers.length ===
                              0 && (
                              <div className="customer-picker-empty">
                                No matching
                                customer. Use “+
                                New customer” to
                                create one.
                              </div>
                            )}
                          </div>
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
                onChange={(event) =>
                  setBookingVehicleId(
                    event.target.value,
                  )
                }
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

            {/*
              * A hire that started before the office had this
              * system is still running, so it cannot be filed
              * as a past booking — that closes a rental — and
              * it cannot be booked ahead either. Ticking this
              * lets the pickup sit in the past; the booking is
              * otherwise ordinary, and still has to be checked
              * out, extended and returned here.
              */}
            <div className="field full">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  name="backdated"
                  checked={backdated}
                  onChange={(event) =>
                    setBackdated(
                      event.target.checked,
                    )
                  }
                />
                This rental already started
              </label>

              <p className="form-help">
                {backdated
                  ? "The pickup is in the past and the return can be either side of today. The vehicle is still held and checked out here as usual. To record a hire that has already come back, use Past booking on the customer's record instead."
                  : "Tick this to write down a hire that went out before it was booked here and has not come back yet."}
              </p>
            </div>

            <div className="field">
              <label htmlFor="pickup">
                Pickup
              </label>

              <input
                id="pickup"
                name="pickupAt"
                type="datetime-local"
                min={
                  backdated
                    ? undefined
                    : todayDateTime()
                }
                max={
                  backdated
                    ? todayDateTime()
                    : undefined
                }
                onChange={(event) =>
                  setBookingPickupAt(
                    event.target.value,
                  )
                }
                required
              />
            </div>

            <div className="field">
              <label htmlFor="expected-return">
                Expected return
              </label>

              {/*
                * A rental that started in the past may be due
                * back at any point — next week, or last week
                * if it is running late — so only an ordinary
                * booking is held to a future return.
                */}
              <input
                id="expected-return"
                name="expectedReturnAt"
                type="datetime-local"
                min={
                  backdated
                    ? undefined
                    : todayDateTime()
                }
                onChange={(event) =>
                  setBookingReturnAt(
                    event.target.value,
                  )
                }
                required
              />
            </div>

            <DailyRateDiscountField
              idPrefix="booking-rate-discount"
              draft={bookingRateDiscount}
              onChange={setBookingRateDiscount}
              rates={bookingRates}
              period={bookingPeriod}
              isAdmin={isAdmin}
            />

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
                onChange={(event) => {
                  setCheckoutReservationId(
                    event.target.value,
                  );

                  setCheckoutDamage(null);
                }}
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

              {checkoutReservationId &&
                waitingCancellation(
                  checkoutReservationId,
                ) && (
                  <p className="form-help">
                    A cancellation of this booking is
                    waiting for approval. Checking it out
                    withdraws the request.
                  </p>
                )}
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

            </div>

            {/* ------------------ waivers and charges */}
            <fieldset className="field full checkout-block">
              <legend>
                Due at checkout
              </legend>


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

            </fieldset>

            {/* ---------------- discount on the daily rate */}
            {checkoutBookingDiscount ? (
              <div className="field full">
                <p className="form-help">
                  <span
                    className={
                      checkoutBookingDiscount ===
                      "pending"
                        ? "status-pill cleaning"
                        : "status-pill available"
                    }
                  >
                    {checkoutBookingDiscount ===
                    "pending"
                      ? "Daily-rate discount waiting for approval"
                      : "Daily-rate discount applied"}
                  </span>{" "}
                  {(() => {
                    const asked =
                      pendingDiscounts.find(
                        (discount) =>
                          discount.id ===
                          checkoutReservationQuote?.dailyRateDiscountId,
                      );

                    return asked
                      ? `${describeDailyRateDiscount(
                          asked,
                        )} — ${asked.reason}. `
                      : "";
                  })()}
                  {checkoutBookingDiscount ===
                  "pending"
                    ? "Asked for on the booking; it carries through checkout and the hire is charged the full rate until it is approved."
                    : "The rental days below are already at the discounted daily rate."}
                </p>
              </div>
            ) : (
              <DailyRateDiscountField
                idPrefix="checkout-rate-discount"
                draft={checkoutRateDiscount}
                onChange={setCheckoutRateDiscount}
                rates={
                  checkoutReservationQuote?.rates ??
                  null
                }
                period={checkoutPeriod}
                isAdmin={isAdmin}
                disabled={!checkoutReservationQuote}
              />
            )}

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
                      Insurance, car seats and
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

                  {checkoutDiscountCents > 0 && (
                    <div>
                      <dt>
                        {isAdmin
                          ? "Daily-rate discount"
                          : "Daily-rate discount (waiting for approval)"}
                      </dt>
                      <dd>
                        −
                        {formatMoney(
                          checkoutDiscountCents,
                        )}
                      </dd>
                    </div>
                  )}

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

                  <div>
                    <dt>Paid now (rental)</dt>
                    <dd>
                      {formatMoney(
                        checkoutPaidNowCents,
                      )}
                    </dd>
                  </div>

                  <div className="payment-due-total">
                    <dt>
                      Balance due after checkout
                    </dt>
                    <dd>
                      {formatMoney(
                        balanceAfterCheckoutCents,
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

              <p className="form-help">
                Choose how the renter is paying, then
                enter what they pay now. It is saved
                as a payment on this rental; anything
                not paid now stays as the balance due
                and is collected on the Payment tab.
                The deposit is recorded on its own.
              </p>

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

                <div className="field">
                  <label htmlFor="checkout-paid-now">
                    Paid now, excluding deposit (USD)
                  </label>

                  <input
                    id="checkout-paid-now"
                    type="number"
                    min={0}
                    step="0.01"
                    max={(
                      checkoutRentalDueCents / 100
                    ).toFixed(2)}
                    value={checkoutPaidNow}
                    onChange={(event) =>
                      setCheckoutPaidNow(
                        event.target.value,
                      )
                    }
                  />

                  {checkoutReservationQuote && (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        setCheckoutPaidNow(
                          (
                            checkoutRentalDueCents /
                            100
                          ).toFixed(2),
                        )
                      }
                    >
                      Paid in full ·{" "}
                      {formatMoney(
                        checkoutRentalDueCents,
                      )}
                    </button>
                  )}
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
              <DamageDiagram
                label="Mark scratches and dents"
                hint={
                  checkoutDamageBaseline.length > 0
                    ? "Damage already recorded on this vehicle is shown. Choose a kind, then tap the drawing where it is; tap a mark to remove it."
                    : "Choose a kind, then tap the drawing where it is; tap a mark to remove it."
                }
                marks={checkoutDamageMarks}
                onChange={setCheckoutDamage}
                baseline={checkoutDamageBaseline}
              />
            </div>

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

        {tab === "return" &&
          isAdmin &&
          waitingReturns.length > 0 && (
            <fieldset className="field full checkout-block">
              <legend>
                Backdated returns waiting for your
                approval
              </legend>

              {waitingReturns.map((request) => (
                <div
                  className="discount-request"
                  key={request.id}
                >
                  <p>
                    <strong>
                      {request.vehicleRegistration}
                    </strong>
                    {" · "}
                    {request.customerName}
                  </p>

                  <p className="form-help">
                    Returned{" "}
                    <strong>
                      {formatDate(
                        request.requestedReturnAt,
                        {
                          hour: "numeric",
                          minute: "2-digit",
                        },
                      )}
                    </strong>
                    {" · entered "}
                    {formatDate(request.enteredAt, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {" by "}
                    {request.requestedByName ||
                      "staff"}
                  </p>

                  <p className="form-help">
                    “{request.reason}”
                  </p>

                  <input
                    aria-label="Decision note"
                    placeholder="Note (required to reject)"
                    maxLength={1000}
                    value={
                      returnRequestNotes[
                        request.id
                      ] ?? ""
                    }
                    onChange={(event) =>
                      setReturnRequestNotes(
                        (current) => ({
                          ...current,
                          [request.id]:
                            event.target.value,
                        }),
                      )
                    }
                  />

                  <div className="form-actions">
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={busy}
                      onClick={() =>
                        decideReturn(
                          request,
                          "approve",
                        )
                      }
                    >
                      Approve
                    </button>

                    <button
                      type="button"
                      className="button"
                      disabled={
                        busy ||
                        !returnRequestNotes[
                          request.id
                        ]?.trim()
                      }
                      onClick={() =>
                        decideReturn(
                          request,
                          "reject",
                        )
                      }
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </fieldset>
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
                onChange={(event) => {
                  setReturnRentalId(
                    event.target.value,
                  );

                  setReturnDamage(null);
                }}
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
                      {rental.returnRequestStatus ===
                      "pending"
                        ? " · BACKDATED RETURN WAITING"
                        : ""}
                    </option>
                  ),
                )}
              </select>

              {returnWaiting && (
                <p className="form-help">
                  <span className="status-pill cleaning">
                    Backdated return waiting for
                    approval
                  </span>{" "}
                  The rental stays open until an
                  administrator decides it, and it
                  cannot be returned again meanwhile.
                </p>
              )}

              {!returnWaiting && rejectedReturn && (
                <p className="form-help">
                  Backdated return rejected
                  {rejectedReturn.reviewedByName
                    ? ` by ${rejectedReturn.reviewedByName}`
                    : ""}
                  {rejectedReturn.reviewNote
                    ? ` · “${rejectedReturn.reviewNote}”`
                    : ""}
                </p>
              )}
            </div>

            <div className="field">
              <label htmlFor="return-time">
                Return time
              </label>

              {/*
                * Any time from when the vehicle went out up to
                * now. More than fifteen minutes back is a
                * backdated return, which needs a reason.
                */}
              <input
                id="return-time"
                name="actualReturnAt"
                type="datetime-local"
                defaultValue={todayDateTime()}
                min={localInputValue(
                  returnRental?.returnFloorAt ??
                    null,
                )}
                max={todayDateTime()}
                onChange={(event) =>
                  setReturnTimeEdited(
                    event.target.value,
                  )
                }
                required
              />

              {returnTimeBackdated && (
                <p className="form-help">
                  {isAdmin
                    ? "Backdated return: recorded at once, with the reason below."
                    : "Backdated return: it is sent to an administrator for approval, and the rental stays open until then."}
                </p>
              )}
            </div>

            {returnTimeBackdated && (
              <div className="field full">
                <label htmlFor="backdated-reason">
                  Reason for the earlier return
                  time (required)
                </label>

                <input
                  id="backdated-reason"
                  maxLength={500}
                  required
                  placeholder="e.g. Returned after hours, keys left in the drop box"
                  value={backdatedReason}
                  onChange={(event) =>
                    setBackdatedReason(
                      event.target.value,
                    )
                  }
                />
              </div>
            )}

            <div className="field">
              <label htmlFor="return-odometer">
                Return odometer (optional)
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
                required
                defaultValue=""
              >
                <option value="">
                  Select fuel level
                </option>

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
              <label htmlFor="return-extra-hours">
                Extra hours
              </label>

              <input
                id="return-extra-hours"
                type="number"
                min={0}
                max={999}
                step={1}
                value={returnExtraHours}
                onChange={(event) =>
                  setReturnExtraHours(
                    event.target.value,
                  )
                }
              />
            </div>

            {/* ------------------ charges raised at return */}
            <fieldset className="field full checkout-block">
              <legend>
                Waivers taken
              </legend>

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

            <fieldset className="field full checkout-block">
              <legend>
                Due at return
              </legend>


              {/*
                * Discounts are given on the daily rate at
                * booking or checkout, never at the end.
                */}
              <div className="checkout-charges">
                {returnAdjustmentOptions
                  .map(
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

              </div>
            </fieldset>

            <div className="field full">
              <DamageDiagram
                label="Damage at return"
                hint="What it went out with is already marked. Mark anything new — it is shown in red — and tap a mark to remove it if it has been put right."
                marks={returnDamageMarks}
                onChange={setReturnDamage}
                baseline={returnDamageBaseline}
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
                  !rentals.length ||
                  returnWaiting
                }
              >
                {returnTimeBackdated && !isAdmin
                  ? "Send for approval"
                  : "Complete return"}
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
                attached. Every rental
                still out is listed, so
                rent on a long hire can be
                taken whether or not a
                balance is showing.
              </p>
            </div>

            {/*
              * An administrator decides waiting discounts here,
              * where the balances they come off are settled.
              */}
            {isAdmin &&
              pendingDiscounts.length > 0 && (
                <fieldset className="field full checkout-block">
                  <legend>
                    Discounts waiting for your
                    approval
                  </legend>

                  {pendingDiscounts.map(
                    (discount) => (
                      <div
                        className="discount-request"
                        key={discount.id}
                      >
                        <p>
                          <strong>
                            {discount.dailyRate
                              ? describeDailyRateDiscount(
                                  discount,
                                )
                              : formatMoney(
                                  discount.amountCents,
                                )}
                          </strong>
                          {discount.dailyRate
                            ? " · "
                            : " off "}
                          {
                            discount.vehicleRegistration
                          }
                          {" · "}
                          {discount.customerName}
                        </p>

                        <p className="form-help">
                          {discount.reason}
                          {" — asked by "}
                          {discount.requestedByName ||
                            "staff"}
                          {discount.dailyRate
                            ? discount.rentalId
                              ? " at checkout"
                              : " on the booking"
                            : " at the end of the hire"}
                        </p>

                        <input
                          aria-label="Review note"
                          placeholder="Note (optional)"
                          maxLength={1000}
                          value={
                            reviewNotes[
                              discount.id
                            ] ?? ""
                          }
                          onChange={(event) =>
                            setReviewNotes(
                              (current) => ({
                                ...current,
                                [discount.id]:
                                  event.target
                                    .value,
                              }),
                            )
                          }
                        />

                        <div className="form-actions">
                          <button
                            type="button"
                            className="button button-primary"
                            disabled={busy}
                            onClick={() =>
                              decideDiscount(
                                discount,
                                "approve",
                              )
                            }
                          >
                            Approve
                          </button>

                          <button
                            type="button"
                            className="button"
                            disabled={busy}
                            onClick={() =>
                              decideDiscount(
                                discount,
                                "reject",
                              )
                            }
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ),
                  )}
                </fieldset>
              )}

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
                  selectPaymentRental(
                    event.target.value,
                  )
                }
              >
                <option
                  value=""
                  disabled
                >
                  Select rental
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
                      {rental.outstandingCents > 0
                        ? `${formatMoney(
                            rental.outstandingCents,
                          )} due`
                        : rental.paidThroughAt
                          ? `rent to ${formatDate(
                              rental.paidThroughAt,
                            )}`
                          : "settled"}
                      {rental.rentOverdue
                        ? " · RENT OVERDUE"
                        : ""}
                    </option>
                  ),
                )}
              </select>
            </div>

            {/*
              * Rent on a hire that is still out. The date the
              * rent has been charged to is the expected return;
              * charging further moves it, the way an extension
              * does, so the vehicle stops showing as overdue.
              */}
            {selectedPayableRental?.paidThroughAt && (
              <fieldset className="field full checkout-block">
                <legend>Rent</legend>

                <p className="form-help">
                  Rent charged to{" "}
                  <strong>
                    {formatDate(
                      selectedPayableRental.paidThroughAt,
                      {
                        hour: "numeric",
                        minute: "2-digit",
                      },
                    )}
                  </strong>
                  {rentIsOverdue
                    ? ". The vehicle is still out past that date, so rent up to now is added below."
                    : ". To take rent in advance, choose how far it is paid to."}
                </p>

                <div className="field">
                  <label htmlFor="charge-through">
                    Charge rent to
                  </label>

                  <input
                    id="charge-through"
                    type="datetime-local"
                    value={chargeThrough}
                    onChange={(event) =>
                      setChargeThrough(
                        event.target.value,
                      )
                    }
                  />
                </div>

                <div className="field">
                  <span className="form-help">
                    Rent for this period
                  </span>

                  <strong>
                    {formatMoney(
                      rentChargeCents,
                    )}
                  </strong>
                </div>
              </fieldset>
            )}

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

                <option value="account_credit">
                  Credit
                </option>

                <option value="ath">
                  ATH
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
            {/*
              * Discounts are no longer offered at the end of a
              * hire. One asked for here before that changed
              * still waits for an administrator, so it is shown.
              */}
            {selectedPayableRental &&
              pendingDiscountForRental && (
                <fieldset className="field full checkout-block">
                  <legend>Discount</legend>

                  <p className="form-help">
                    <strong>
                      {pendingDiscountForRental.dailyRate
                        ? describeDailyRateDiscount(
                            pendingDiscountForRental,
                          )
                        : formatMoney(
                            pendingDiscountForRental.amountCents,
                          )}
                    </strong>{" "}
                    discount waiting for an
                    administrator&apos;s approval
                    {" — "}
                    {pendingDiscountForRental.reason}.
                    The balance changes once it is
                    approved.
                  </p>
                </fieldset>
              )}

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

                  {rentChargeCents > 0 && (
                    <div>
                      <dt>Rent for this period</dt>
                      <dd>
                        {formatMoney(
                          rentChargeCents,
                        )}
                      </dd>
                    </div>
                  )}

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
    </AppShell>
  );
}