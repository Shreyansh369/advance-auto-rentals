

import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";

import { httpsCallable } from "firebase/functions";

import { getFirebaseClient } from "@/lib/firebase/client";
import {
  calculateBalance,
  quoteRental,
} from "@/packages/domain/src/pricing";
import type {
  VehicleDocument,
  VehicleStatus,
} from "@/packages/domain/src/types";
import { isValidVehicleTransition } from "@/packages/domain/src/lifecycle";

/* =========================================================
   Shared types
   ========================================================= */

export type DashboardSummary = {
  totalFleet: number;
  available: number;
  reserved: number;
  todayPickups: number;
  todayReturns: number;
  overdue: number;
  maintenanceDue: number;
  expiringDocuments: number;
  upcomingReservations: Array<{
    id: string;
    pickupAt: string;
    customerName: string;
    vehicleRegistration: string;
  }>;
  activeRentals: Array<{
    id: string;
    customerName: string;
    vehicleRegistration: string;
    expectedReturnAt: string;
    checkedOutBy: string;
    status: "active" | "overdue";
  }>;
};
export type PayableRental = {
  id: string;
  customerName: string;
  vehicleRegistration: string;
  status: string;
  outstandingCents: number;
};
export type FinancialOverview = {
  from: string;
  to: string;
  vehicleId: string | null;
  invoicedCents: number;
  receivedCents: number;
  refundedCents: number;
  expensesCents: number;
  netCashCents: number;
  operatingMarginCents: number;
  outstandingCents: number;
  outstandingRentals: number;
  vehiclePerformance: Array<{
    vehicleId: string;
    vehicleRegistration: string;
    invoicedCents: number;
    expensesCents: number;
    receivedCents: number;
    operatingMarginCents: number;
  }>;
  recentEntries: Array<{
    id: string;
    entryType: string;
    vehicleRegistration: string;
    amountCents: number;
    occurredAt: string;
  }>;
};

export type StaffRegistrationInput = {
  fullName: string;
  mobile: string;
  age: number;
  requestedRole: "admin" | "operations";
};

export type StaffRegistrationResult = {
  uid: string;
  status: "pending";
};

/*
 * Firestore documents returned by the Web SDK are intentionally
 * represented as flexible records in this migration layer.
 *
 * The UI-level data remains strongly typed.
 */
type FirestoreDoc = {
  id: string;
  [key: string]: any;
};

/* =========================================================
   Helpers
   ========================================================= */

function getActorUid(): string {
  const user = getFirebaseClient().auth.currentUser;

  if (!user) {
    throw new Error(
      "Your session has expired. Please sign in again.",
    );
  }

  return user.uid;
}

async function callTrustedFunction<
  TInput extends Record<string, unknown>,
  TResult,
>(
  name: string,
  data: TInput,
): Promise<TResult> {
  const callable = httpsCallable<
    TInput,
    TResult
  >(
    getFirebaseClient().functions,
    name,
  );

  const result = await callable(data);
  return result.data;
}

function toIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const date = new Date(value);

    if (!Number.isNaN(date.valueOf())) {
      return date.toISOString();
    }
  }

  return new Date(0).toISOString();
}

function asTimestamp(value: string): Timestamp {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new Error("Invalid date.");
  }

  return Timestamp.fromDate(date);
}

function nowTimestamp() {
  return serverTimestamp();
}

/* =========================================================
   Staff registration
   ========================================================= */

export async function registerStaffProfile(
  input: StaffRegistrationInput,
): Promise<StaffRegistrationResult> {
  const { auth, db } = getFirebaseClient();

  const user = auth.currentUser;

  if (!user) {
    throw new Error(
      "Your account could not be verified. Please sign in again.",
    );
  }

  if (!user.email) {
    throw new Error(
      "The authenticated account does not have an email address.",
    );
  }

  const profileRef = doc(
    db,
    "users",
    user.uid,
  );

  await runTransaction(
    db,
    async (transaction) => {
      const existing =
        await transaction.get(profileRef);

      if (existing.exists()) {
        throw new Error(
          "A staff profile already exists for this account.",
        );
      }

      transaction.set(profileRef, {
        fullName:
          input.fullName.trim(),
        mobile:
          input.mobile.trim(),
        age: input.age,
        email:
          user.email!.trim().toLowerCase(),
        requestedRole:
          input.requestedRole,
        role: null,
        status: "pending",
        createdAt:
          nowTimestamp(),
        updatedAt:
          nowTimestamp(),
      });
    },
  );

  return {
    uid: user.uid,
    status: "pending",
  };
}

/* =========================================================
   Dashboard
   ========================================================= */

async function getOperationalDashboard(): Promise<DashboardSummary> {
  const { db } =
    getFirebaseClient();

  const [
    vehicleSnapshot,
    reservationSnapshot,
    rentalSnapshot,
  ] = await Promise.all([
    getDocs(
      query(
        collection(db, "vehicles"),
        orderBy("registrationNumber"),
        limit(500),
      ),
    ),

    getDocs(
      query(
        collection(db, "reservations"),
        limit(500),
      ),
    ),

    getDocs(
      query(
        collection(db, "rentals"),
        limit(500),
      ),
    ),
  ]);

  const vehicles: FirestoreDoc[] =
    vehicleSnapshot.docs.map(
      (snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
      }),
    );

  const reservations: FirestoreDoc[] =
    reservationSnapshot.docs.map(
      (snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
      }),
    );

  const rentals: FirestoreDoc[] =
    rentalSnapshot.docs.map(
      (snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
      }),
    );

  const now = new Date();

  const startOfToday =
    new Date(now);

  startOfToday.setHours(
    0,
    0,
    0,
    0,
  );

  const endOfToday =
    new Date(now);

  endOfToday.setHours(
    23,
    59,
    59,
    999,
  );

  const nextSevenDays =
    new Date(now);

  nextSevenDays.setDate(
    nextSevenDays.getDate() + 7,
  );

  const available =
    vehicles.filter(
      (vehicle) =>
        vehicle.status ===
        "available",
    ).length;

  const reserved =
    vehicles.filter(
      (vehicle) =>
        vehicle.status ===
        "reserved",
    ).length;

  const todayPickups =
    reservations.filter(
      (reservation) => {
        if (!reservation.pickupAt) {
          return false;
        }

        const pickup =
          new Date(
            toIso(
              reservation.pickupAt,
            ),
          );

        return (
          pickup >=
            startOfToday &&
          pickup <=
            endOfToday
        );
      },
    ).length;

  const todayReturns =
    rentals.filter(
      (rental) => {
        if (!rental.actualReturnAt) {
          return false;
        }

        const returned =
          new Date(
            toIso(
              rental.actualReturnAt,
            ),
          );

        return (
          returned >=
            startOfToday &&
          returned <=
            endOfToday
        );
      },
    ).length;

  const overdue =
    rentals.filter(
      (rental) => {
        if (
          rental.status ===
          "overdue"
        ) {
          return true;
        }

        if (
          ![
            "active",
            "overdue",
          ].includes(
            String(
              rental.status,
            ),
          )
        ) {
          return false;
        }

        if (
          !rental.expectedReturnAt
        ) {
          return false;
        }

        return (
          new Date(
            toIso(
              rental.expectedReturnAt,
            ),
          ).getTime() <
          now.getTime()
        );
      },
    ).length;

  const maintenanceDue =
    vehicles.filter(
      (vehicle) => {
        if (
          !vehicle.nextServiceDueAt
        ) {
          return false;
        }

        return (
          new Date(
            toIso(
              vehicle.nextServiceDueAt,
            ),
          ).getTime() <=
          now.getTime()
        );
      },
    ).length;

  const expiringDocuments =
    vehicles.filter(
      (vehicle) => {
        const threshold =
          now.getTime() +
          30 *
            24 *
            60 *
            60 *
            1000;

        const registrationExpiry =
          vehicle.registrationExpiresAt
            ? new Date(
                toIso(
                  vehicle.registrationExpiresAt,
                ),
              ).getTime()
            : 0;

        const insuranceExpiry =
          vehicle.insuranceExpiresAt
            ? new Date(
                toIso(
                  vehicle.insuranceExpiresAt,
                ),
              ).getTime()
            : 0;

        return (
          (registrationExpiry >
            0 &&
            registrationExpiry <=
              threshold) ||
          (insuranceExpiry >
            0 &&
            insuranceExpiry <=
              threshold)
        );
      },
    ).length;

  const activeRentals =
    rentals
      .filter((rental) =>
        ["active", "overdue"].includes(
          String(rental.status),
        ),
      )
      .filter((rental) => Boolean(rental.expectedReturnAt))
      .sort(
        (a, b) =>
          new Date(
            toIso(a.expectedReturnAt),
          ).getTime() -
          new Date(
            toIso(b.expectedReturnAt),
          ).getTime(),
      )
      .slice(0, 20)
      .map((rental) => ({
        id: rental.id,
        customerName: String(
          rental.customerNameSnapshot ??
            "Unknown customer",
        ),
        vehicleRegistration: String(
          rental.vehicleRegistrationSnapshot ??
            "Unknown vehicle",
        ),
        expectedReturnAt: toIso(
          rental.expectedReturnAt,
        ),
        checkedOutBy: String(
          rental.checkedOutByNameSnapshot ??
            "—",
        ),
        status:
          rental.status === "overdue"
            ? "overdue"
            : "active",
      })) as DashboardSummary["activeRentals"];

  const upcomingReservations =
    reservations
      .filter(
        (reservation) => {
          if (
            reservation.status !==
            "confirmed"
          ) {
            return false;
          }

          if (
            !reservation.pickupAt
          ) {
            return false;
          }

          const pickup =
            new Date(
              toIso(
                reservation.pickupAt,
              ),
            );

          return (
            pickup >= now &&
            pickup <=
              nextSevenDays
          );
        },
      )
      .sort(
        (a, b) =>
          new Date(
            toIso(a.pickupAt),
          ).getTime() -
          new Date(
            toIso(b.pickupAt),
          ).getTime(),
      )
      .slice(0, 10)
      .map(
        (
          reservation,
        ) => ({
          id:
            reservation.id,
          pickupAt:
            toIso(
              reservation.pickupAt,
            ),
          customerName:
            String(
              reservation.customerNameSnapshot ??
                "Unknown customer",
            ),
          vehicleRegistration:
            String(
              reservation.vehicleRegistrationSnapshot ??
                "Unknown vehicle",
            ),
        }),
      );

  return {
    totalFleet:
      vehicles.length,
    available,
    reserved,
    todayPickups,
    todayReturns,
    overdue,
    maintenanceDue,
    expiringDocuments,
    upcomingReservations,
    activeRentals,
  };
}
async function getPayableRentals(): Promise<PayableRental[]> {
  const { db } = getFirebaseClient();

  const snapshot = await getDocs(
    query(
      collection(db, "rentalFinancials"),
      where("outstandingCents", ">", 0),
      limit(500),
    ),
  );

  return snapshot.docs
    .map((snapshot) => {
      const data = snapshot.data();

      return {
        id: String(
          data.rentalId ?? snapshot.id,
        ),
        customerName: String(
          data.customerNameSnapshot ??
            data.customerName ??
            "Unknown customer",
        ),
        vehicleRegistration: String(
          data.vehicleRegistration ??
            data.vehicleRegistrationSnapshot ??
            "Unknown vehicle",
        ),
        status: String(
          data.rentalStatus ?? "active",
        ),
        outstandingCents: Number(
          data.outstandingCents ?? 0,
        ),
        updatedAt:
          data.updatedAt instanceof Timestamp
            ? data.updatedAt.toMillis()
            : 0,
      };
    })
    .filter(
      (rental) =>
        Number.isFinite(
          rental.outstandingCents,
        ) &&
        rental.outstandingCents > 0,
    )
    .sort(
      (a, b) =>
        b.updatedAt - a.updatedAt,
    )
    .map(
      ({
        updatedAt: _updatedAt,
        ...rental
      }) => rental,
    );
}
/* =========================================================
   Customer
   ========================================================= */

async function createOrUpdateCustomer(
  input: Record<string, unknown>,
): Promise<{
  customerId: string;
}> {
  const { db } =
    getFirebaseClient();

  const customerRef = doc(
    collection(
      db,
      "customers",
    ),
  );

await runTransaction(
  db,
  async (transaction) => {
    const licenceExpiresAt =
      input.licenceExpiresAt
        ? String(
            input.licenceExpiresAt,
          )
        : null;

    if (licenceExpiresAt) {
      const today =
        new Date();

      today.setHours(
        0,
        0,
        0,
        0,
      );

      const expiryDate =
        new Date(
          `${licenceExpiresAt}T00:00:00`,
        );

      expiryDate.setHours(
        0,
        0,
        0,
        0,
      );

      if (
        Number.isNaN(
          expiryDate.getTime(),
        ) ||
        expiryDate.getTime() <=
          today.getTime()
      ) {
        throw new Error(
          "Licence expiry must be after today.",
        );
      }
    }

    transaction.set(
      customerRef,
      {
          fullName:
            String(
              input.fullName ??
                "",
            ).trim(),

          telephone:
            String(
              input.telephone ??
                "",
            ).trim(),

          email:
            input.email == null
              ? null
              : String(
                  input.email,
                ).trim() || null,

          address:
            input.address == null
              ? null
              : String(
                  input.address,
                ).trim() || null,

          licenceNumber:
            String(
              input.licenceNumber ??
                "",
            )
              .trim()
              .toUpperCase(),

          licenceCountry:
            String(
              input.licenceCountry ??
                "IN",
            )
              .trim()
              .toUpperCase(),

          licenceExpiresAt:
  licenceExpiresAt,

          dateOfBirth:
            input.dateOfBirth == null
              ? null
              : String(
                  input.dateOfBirth,
                ),

          notes:
            input.notes == null
              ? null
              : String(
                  input.notes,
                ).trim() || null,

          licenceStoragePath:
            input.licenceStoragePath ==
            null
              ? null
              : String(
                  input.licenceStoragePath,
                ),

          createdAt:
            nowTimestamp(),

          updatedAt:
            nowTimestamp(),
        },
      );
    },
  );

  return {
    customerId:
      customerRef.id,
  };
}

async function updateCustomerLicenceDocument(
  input: {
    customerId: string;
    licenceStoragePath: string;
  },
): Promise<{
  customerId: string;
  licenceStoragePath: string;
}> {
  const callable =
    httpsCallable<
      typeof input,
      {
        customerId: string;
        licenceStoragePath: string;
      }
    >(
      getFirebaseClient().functions,
      "updateCustomerLicenceDocument",
    );

  const result =
    await callable(input);

  return result.data;
}

async function sendReservationContract(
  input: { reservationId: string },
): Promise<{ emailId: string }> {
  const callable =
    httpsCallable<
      typeof input,
      { emailId: string }
    >(
      getFirebaseClient().functions,
      "sendReservationContract",
    );

  const result = await callable(input);
  return result.data;
}

/* =========================================================
   Reservation
   ========================================================= */

async function createReservation(
  input: {
    customerId: string;
    vehicleId: string;
    pickupAt: string;
    expectedReturnAt: string;
    pickupLocation: string | null;
    dropoffLocation: string | null;
    notes: string | null;
    bookingMedia: Array<Record<string, unknown>>;
    customerSignatureDataUrl: string;
  },
): Promise<{
  reservationId: string;
  quote: {
    baseRentalCents: number;
    chargedDays: number;
  };
}> {
  const callable =
    httpsCallable<
      typeof input,
      {
        reservationId: string;
        quote: {
          baseRentalCents: number;
          chargedDays: number;
        };
      }
    >(
      getFirebaseClient().functions,
      "createReservation",
    );

  const result = await callable(input);
  return result.data;
}

/* =========================================================
   Checkout
   ========================================================= */

async function checkoutReservation(
  input: {
    reservationId: string;
    pickupFuelLevel: string;
    pickupOdometerKm: number;
    notes: string | null;
  },
): Promise<{
  rentalId: string;
}> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  const reservationRef =
    doc(
      db,
      "reservations",
      input.reservationId,
    );

  const rentalRef =
    doc(
      collection(
        db,
        "rentals",
      ),
    );

  await runTransaction(
    db,
    async (transaction) => {
      const reservationSnapshot =
        await transaction.get(
          reservationRef,
        );

      if (
        !reservationSnapshot.exists()
      ) {
        throw new Error(
          "Reservation was not found.",
        );
      }

      const reservation =
        reservationSnapshot.data();

      if (
        reservation.status !==
        "confirmed"
      ) {
        throw new Error(
          "Reservation cannot be checked out.",
        );
      }

      const vehicleRef =
        doc(
          db,
          "vehicles",
          String(
            reservation.vehicleId,
          ),
        );

      const vehicleSnapshot =
        await transaction.get(
          vehicleRef,
        );

      if (
        !vehicleSnapshot.exists()
      ) {
        throw new Error(
          "Vehicle was not found.",
        );
      }

      if (
        vehicleSnapshot.get(
          "status",
        ) !== "reserved"
      ) {
        throw new Error(
          "Vehicle is no longer ready for checkout.",
        );
      }

      const financialRef =
        doc(
          db,
          "rentalFinancials",
          rentalRef.id,
        );

      transaction.set(
        rentalRef,
        {
          ...reservation,

          reservationId:
            reservationRef.id,

          status: "active",

          pickupFuelLevel:
            input.pickupFuelLevel,

          pickupOdometerKm:
            input.pickupOdometerKm,

          checkoutNotes:
            input.notes,

          actualReturnAt:
            null,

          createdAt:
            nowTimestamp(),

          updatedAt:
            nowTimestamp(),

          checkedOutBy:
            actorUid,
        },
      );

      transaction.set(
        financialRef,
        {
          rentalId:
            rentalRef.id,

          vehicleId:
            reservation.vehicleId,

          vehicleRegistration:
            reservation.vehicleRegistrationSnapshot,

          customerId:
            reservation.customerId,

          rentalStatus:
            "active",

          pickupAt:
            reservation.pickupAt,

          baseRentalCents:
            reservation.quote
              .baseRentalCents,

          adjustmentCents: 0,

          totalCents:
            reservation.quote
              .baseRentalCents,

          paidCents: 0,

          refundedCents: 0,

          refundedPaymentCents:
            0,

          depositHeldCents: 0,

          refundedDepositCents:
            0,

          outstandingCents:
            reservation.quote
              .baseRentalCents,

          currency:
            "USD",

          createdAt:
            nowTimestamp(),

          updatedAt:
            nowTimestamp(),
        },
      );

      transaction.update(
        reservationRef,
        {
          status:
            "checked_out",

          updatedAt:
            nowTimestamp(),
        },
      );

      transaction.update(
        vehicleRef,
        {
          status:
            "rented",

          updatedAt:
            nowTimestamp(),
        },
      );

      const ledgerRef =
        doc(
          collection(
            db,
            "financialLedger",
          ),
        );

      transaction.set(
        ledgerRef,
        {
          rentalId:
            rentalRef.id,

          vehicleId:
            reservation.vehicleId,

          vehicleRegistration:
            reservation.vehicleRegistrationSnapshot,

          customerId:
            reservation.customerId,

          entryType:
            "rental_checkout",

          amountCents:
            reservation.quote
              .baseRentalCents,

          occurredAt:
            nowTimestamp(),

          recordedBy:
            actorUid,
        },
      );
    },
  );

  return {
    rentalId:
      rentalRef.id,
  };
}

/* =========================================================
   Extend rental
   ========================================================= */

async function extendRental(
  input: {
    rentalId: string;
    expectedReturnAt: string;
    note: string;
    idempotencyKey: string;
  },
): Promise<{
  extensionCents: number;
  outstandingCents: number;
}> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  const rentalRef =
    doc(
      db,
      "rentals",
      input.rentalId,
    );

  const financialRef =
    doc(
      db,
      "rentalFinancials",
      input.rentalId,
    );

  const operationRef =
    doc(
      db,
      "idempotencyKeys",
      `extension_${input.idempotencyKey}`,
    );

  let response:
    | {
        extensionCents: number;
        outstandingCents: number;
      }
    | undefined;

  await runTransaction(
    db,
    async (transaction) => {
      const previous =
        await transaction.get(
          operationRef,
        );

      if (previous.exists()) {
        response =
          previous.get(
            "response",
          ) as {
            extensionCents: number;
            outstandingCents: number;
          };

        return;
      }

      const rentalSnapshot =
        await transaction.get(
          rentalRef,
        );

      const financialSnapshot =
        await transaction.get(
          financialRef,
        );

      if (
        !rentalSnapshot.exists() ||
        !financialSnapshot.exists()
      ) {
        throw new Error(
          "Rental was not found.",
        );
      }

      const rental =
        rentalSnapshot.data();

      const financial =
        financialSnapshot.data();

      if (
        ![
          "active",
          "overdue",
        ].includes(
          String(
            rental.status,
          ),
        )
      ) {
        throw new Error(
          "Only active or overdue rentals can be extended.",
        );
      }

      const currentExpectedReturn =
        asTimestamp(
          toIso(
            rental.expectedReturnAt,
          ),
        );

      const newExpectedReturn =
        asTimestamp(
          input.expectedReturnAt,
        );

      if (
        newExpectedReturn.toMillis() <=
        currentExpectedReturn.toMillis()
      ) {
        throw new Error(
          "The extension must be later than the current expected return.",
        );
      }

      const updatedQuote =
        quoteRental(
          {
            pickupAt:
              toIso(
                rental.pickupAt,
              ),

            expectedReturnAt:
              input.expectedReturnAt,
          },

          rental.rateSnapshot,
        );

      const extensionCents =
        updatedQuote.baseRentalCents -
        Number(
          financial.baseRentalCents ??
            0,
        );

      if (
        extensionCents <= 0
      ) {
        throw new Error(
          "The extension does not change the rental total.",
        );
      }

      const totalCents =
        Number(
          financial.totalCents ??
            0,
        ) +
        extensionCents;

      const outstandingCents =
        calculateBalance(
          totalCents,

          Number(
            financial.paidCents ??
              0,
          ),

          Number(
            financial.refundedCents ??
              0,
          ),
        );

      response = {
        extensionCents,
        outstandingCents,
      };

      transaction.update(
        rentalRef,
        {
          expectedReturnAt:
            newExpectedReturn,

          quote:
            updatedQuote,

          updatedAt:
            nowTimestamp(),
        },
      );

      const reservationRef =
        doc(
          db,
          "reservations",
          String(
            rental.reservationId,
          ),
        );

      transaction.update(
        reservationRef,
        {
          expectedReturnAt:
            newExpectedReturn,

          quote:
            updatedQuote,

          updatedAt:
            nowTimestamp(),
        },
      );

      transaction.set(
        doc(
          db,
          "rentals",
          input.rentalId,
          "extensions",
          input.idempotencyKey,
        ),

        {
          previousExpectedReturnAt:
            currentExpectedReturn,

          expectedReturnAt:
            newExpectedReturn,

          extensionCents,

          note:
            input.note,

          recordedBy:
            actorUid,

          recordedAt:
            nowTimestamp(),
        },
      );

      transaction.update(
        financialRef,
        {
          baseRentalCents:
            updatedQuote
              .baseRentalCents,

          totalCents,

          outstandingCents,

          updatedAt:
            nowTimestamp(),
        },
      );

      const ledgerRef =
        doc(
          collection(
            db,
            "financialLedger",
          ),
        );

      transaction.set(
        ledgerRef,
        {
          rentalId:
            rentalRef.id,

          vehicleId:
            rental.vehicleId,

          vehicleRegistration:
            rental.vehicleRegistrationSnapshot,

          customerId:
            rental.customerId,

          entryType:
            "rental_extension",

          amountCents:
            extensionCents,

          note:
            input.note,

          occurredAt:
            nowTimestamp(),

          recordedBy:
            actorUid,
        },
      );

      transaction.set(
        operationRef,
        {
          response,

          actorUid,

          createdAt:
            nowTimestamp(),
        },
      );
    },
  );

  return response!;
}

/* =========================================================
   Return
   ========================================================= */

async function returnRental(
  input: {
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
    returnMedia: Array<
      Record<string, unknown>
    >;
  },
): Promise<{
  outstandingCents: number;
}> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  const rentalRef =
    doc(
      db,
      "rentals",
      input.rentalId,
    );

  const financialRef =
    doc(
      db,
      "rentalFinancials",
      input.rentalId,
    );

  let outstandingCents = 0;

  await runTransaction(
    db,
    async (transaction) => {
      const rentalSnapshot =
        await transaction.get(
          rentalRef,
        );

      const financialSnapshot =
        await transaction.get(
          financialRef,
        );

      if (
        !rentalSnapshot.exists() ||
        !financialSnapshot.exists()
      ) {
        throw new Error(
          "Rental was not found.",
        );
      }

      const rental =
        rentalSnapshot.data();

      const financial =
        financialSnapshot.data();

      if (
        ![
          "active",
          "overdue",
        ].includes(
          String(
            rental.status,
          ),
        )
      ) {
        throw new Error(
          "Only active or overdue rentals can be returned.",
        );
      }

      const actualReturnAt =
        asTimestamp(
          input.actualReturnAt,
        );

      if (
        actualReturnAt.toMillis() <
        asTimestamp(
          toIso(
            rental.pickupAt,
          ),
        ).toMillis()
      ) {
        throw new Error(
          "Actual return cannot be before pickup.",
        );
      }

      if (
        input.returnOdometerKm <
        Number(
          rental.pickupOdometerKm ??
            0,
        )
      ) {
        throw new Error(
          "Return odometer cannot be lower than pickup odometer.",
        );
      }

      const totalAdjustment =
        input.adjustments.reduce(
          (
            total,
            adjustment,
          ) =>
            adjustment.type ===
            "discount"
              ? total -
                adjustment.amountCents
              : total +
                adjustment.amountCents,

          0,
        );

      const adjustmentCents =
        Number(
          financial.adjustmentCents ??
            0,
        ) +
        totalAdjustment;

      const totalCents =
        Number(
          financial.baseRentalCents ??
            0,
        ) +
        adjustmentCents;

      if (totalCents < 0) {
        throw new Error(
          "Adjustments produce an invalid rental total.",
        );
      }

      outstandingCents =
        calculateBalance(
          totalCents,

          Number(
            financial.paidCents ??
              0,
          ),

          Number(
            financial.refundedCents ??
              0,
          ),
        );

      transaction.update(
        rentalRef,
        {
          status:
            "returned",

          actualReturnAt,

          returnFuelLevel:
            input.returnFuelLevel,

          returnOdometerKm:
            input.returnOdometerKm,

          returnNotes:
            input.notes,

          returnMedia:
            input.returnMedia,

          adjustments:
            input.adjustments,

          returnedBy:
            actorUid,

          updatedAt:
            nowTimestamp(),
        },
      );

      transaction.update(
        financialRef,
        {
          adjustmentCents,

          totalCents,

          outstandingCents,

          rentalStatus:
            "returned",

          actualReturnAt,

          updatedAt:
            nowTimestamp(),
        },
      );

      const vehicleRef =
        doc(
          db,
          "vehicles",
          String(
            rental.vehicleId,
          ),
        );

      transaction.update(
        vehicleRef,
        {
          status:
            "cleaning",

          updatedAt:
            nowTimestamp(),
        },
      );

      for (
        const adjustment of
        input.adjustments
      ) {
        if (
          adjustment.amountCents <=
          0
        ) {
          continue;
        }

        const ledgerRef =
          doc(
            collection(
              db,
              "financialLedger",
            ),
          );

        transaction.set(
          ledgerRef,
          {
            rentalId:
              rentalRef.id,

            vehicleId:
              rental.vehicleId,

            vehicleRegistration:
              rental.vehicleRegistrationSnapshot,

            customerId:
              rental.customerId,

            entryType:
              adjustment.type ===
              "discount"
                ? "rental_discount"
                : "rental_adjustment",

            adjustmentType:
              adjustment.type,

            amountCents:
              adjustment.type ===
              "discount"
                ? -adjustment.amountCents
                : adjustment.amountCents,

            note:
              adjustment.note,

            occurredAt:
              nowTimestamp(),

            recordedBy:
              actorUid,
          },
        );
      }
    },
  );

  return {
    outstandingCents,
  };
}

/* =========================================================
   Payment
   ========================================================= */

async function recordRentalPayment(
  input: {
    rentalId: string;
    amountCents: number;
    method: string;
    externalReference:
      | string
      | null;
    idempotencyKey: string;
  },
): Promise<{
  outstandingCents: number;
}> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  if (
    !Number.isFinite(
      input.amountCents,
    ) ||
    input.amountCents <= 0
  ) {
    throw new Error(
      "Payment amount must be greater than zero.",
    );
  }

  const operationRef =
    doc(
      db,
      "idempotencyKeys",
      `payment_${input.idempotencyKey}`,
    );

  const paymentRef =
    doc(
      collection(db, "payments"),
    );

  const financialRef =
    doc(
      db,
      "rentalFinancials",
      input.rentalId,
    );

  let outstandingCents = 0;

  await runTransaction(
    db,
    async (transaction) => {
      const previous =
        await transaction.get(
          operationRef,
        );

      if (previous.exists()) {
        const previousResponse =
          previous.get(
            "response",
          ) as {
            outstandingCents: number;
          };

        outstandingCents =
          previousResponse
            .outstandingCents;

        return;
      }

      const financialSnapshot =
        await transaction.get(
          financialRef,
        );

      const rentalRef =
        doc(
          db,
          "rentals",
          input.rentalId,
        );

      const rentalSnapshot =
        await transaction.get(
          rentalRef,
        );

      if (
        !financialSnapshot.exists() ||
        !rentalSnapshot.exists()
      ) {
        throw new Error(
          "Rental financial record was not found.",
        );
      }

      const financial =
        financialSnapshot.data();

      const paidCents =
        Number(
          financial.paidCents ??
            0,
        ) +
        input.amountCents;

      outstandingCents =
        calculateBalance(
          Number(
            financial.totalCents ??
              0,
          ),
          paidCents,
          Number(
            financial.refundedCents ??
              0,
          ),
        );

      transaction.set(
        paymentRef,
        {
          rentalId:
            input.rentalId,

          amountCents:
            input.amountCents,

          method:
            input.method,

          externalReference:
            input.externalReference,

          recordedBy:
            actorUid,

          occurredAt:
            nowTimestamp(),
        },
      );

      transaction.update(
        financialRef,
        {
          paidCents,

          outstandingCents,

          updatedAt:
            nowTimestamp(),
        },
      );

      const rental =
        rentalSnapshot.data();

      const ledgerRef =
        doc(
          collection(
            db,
            "financialLedger",
          ),
        );

      transaction.set(
        ledgerRef,
        {
          rentalId:
            input.rentalId,

          vehicleId:
            rental.vehicleId,

          vehicleRegistration:
            rental.vehicleRegistrationSnapshot,

          customerId:
            rental.customerId,

          entryType:
            "payment",

          amountCents:
            input.amountCents,

          paymentId:
            paymentRef.id,

          occurredAt:
            nowTimestamp(),

          recordedBy:
            actorUid,
        },
      );

      transaction.set(
        operationRef,
        {
          response: {
            outstandingCents,
          },

          actorUid,

          createdAt:
            nowTimestamp(),
        },
      );
    },
  );

  return {
    outstandingCents,
  };
}

/* =========================================================
   Vehicle creation
   ========================================================= */

async function createVehicle(
  input: {
    registrationNumber: string;
    make: string;
    model: string;
    year: number | null;
    color: string | null;
    vin: string | null;
    registrationExpiresAt: string | null;
    insuranceExpiresAt: string | null;
    lastServiceAt: string | null;
    nextServiceDueAt: string | null;
    dailyCents: number | null;
    weeklyCents: number | null;
    monthlyCents: number | null;
    notes: string | null;
  },
): Promise<{
  vehicleId: string;
  registrationNumber: string;
}> {
  return callTrustedFunction<
    typeof input,
    {
      vehicleId: string;
      registrationNumber: string;
    }
  >(
    "createVehicleRecord",
    input,
  );
}

/* =========================================================
   Vehicle details
   ========================================================= */

async function updateVehicleDetails(
  input: Record<string, unknown>,
): Promise<void> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  const vehicleRef =
    doc(
      db,
      "vehicles",
      String(
        input.vehicleId,
      ),
    );

  await runTransaction(
    db,
    async (transaction) => {
      const snapshot =
        await transaction.get(
          vehicleRef,
        );

      if (!snapshot.exists()) {
        throw new Error(
          "Vehicle was not found.",
        );
      }

      const current =
        snapshot.data() as VehicleDocument;

      const rates = {
        currency:
          "USD" as const,

        dailyCents:
          input.dailyCents ==
          null
            ? null
            : Number(
                input.dailyCents,
              ),

        weeklyCents:
          input.weeklyCents ==
          null
            ? null
            : Number(
                input.weeklyCents,
              ),

        monthlyCents:
          input.monthlyCents ==
          null
            ? null
            : Number(
                input.monthlyCents,
              ),
      };

      transaction.update(
        vehicleRef,
        {
          registrationNumber:
            String(
              input.registrationNumber ??
                current.registrationNumber,
            )
              .trim()
              .toUpperCase(),

          make:
            String(
              input.make ??
                current.make,
            )
              .trim()
              .toUpperCase(),

          model:
            String(
              input.model ??
                current.model,
            ).trim(),

          year:
            input.year == null
              ? null
              : Number(
                  input.year,
                ),

          color:
            input.color == null
              ? null
              : String(
                  input.color,
                ).trim() ||
                null,

          vin:
            input.vin == null
              ? null
              : String(
                  input.vin,
                )
                  .trim()
                  .toUpperCase() ||
                null,

          registrationExpiresAt:
            input.registrationExpiresAt ??
            null,

          insuranceExpiresAt:
            input.insuranceExpiresAt ??
            null,

          lastServiceAt:
            input.lastServiceAt ??
            null,

          nextServiceDueAt:
            input.nextServiceDueAt ??
            null,

          rates,

          notes:
            input.notes == null
              ? null
              : String(
                  input.notes,
                ).trim() ||
                null,

          updatedAt:
            nowTimestamp(),
        },
      );

      const auditRef =
        doc(
          collection(
            db,
            "auditLogs",
          ),
        );

      transaction.set(
        auditRef,
        {
          actorUid,

          action:
            "vehicle.details_updated",

          resource: {
            collection:
              "vehicles",
            id:
              vehicleRef.id,
          },

          details: {
            previousRates:
              current.rates,
            newRates:
              rates,
          },

          createdAt:
            nowTimestamp(),
        },
      );
    },
  );
}

/* =========================================================
   Vehicle status
   ========================================================= */

async function changeVehicleStatus(
  input: {
    vehicleId: string;
    status: VehicleStatus;
    note: string;
  },
): Promise<void> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  const vehicleRef =
    doc(
      db,
      "vehicles",
      input.vehicleId,
    );

  await runTransaction(
    db,
    async (transaction) => {
      const snapshot =
        await transaction.get(
          vehicleRef,
        );

      if (!snapshot.exists()) {
        throw new Error(
          "Vehicle was not found.",
        );
      }

      const vehicle =
        snapshot.data() as VehicleDocument;

      if (
        !isValidVehicleTransition(
          vehicle.status,
          input.status,
        )
      ) {
        throw new Error(
          `Vehicle cannot transition from ${vehicle.status} to ${input.status}.`,
        );
      }

      if (
        input.status ===
        "available"
      ) {
        const now =
          Date.now();

        if (
          !vehicle.insuranceExpiresAt ||
          !vehicle.registrationExpiresAt ||
          Date.parse(
            vehicle.insuranceExpiresAt,
          ) <= now ||
          Date.parse(
            vehicle.registrationExpiresAt,
          ) <= now
        ) {
          throw new Error(
            "Cannot make a vehicle available with expired or missing compliance documents.",
          );
        }
      }

      transaction.update(
        vehicleRef,
        {
          status:
            input.status,

          statusNote:
            input.note,

          updatedAt:
            nowTimestamp(),
        },
      );

      const auditRef =
        doc(
          collection(
            db,
            "auditLogs",
          ),
        );

      transaction.set(
        auditRef,
        {
          actorUid,

          action:
            "vehicle.status_changed",

          resource: {
            collection:
              "vehicles",
            id:
              vehicleRef.id,
          },

          details: {
            from:
              vehicle.status,
            to:
              input.status,
            note:
              input.note,
          },

          createdAt:
            nowTimestamp(),
        },
      );
    },
  );
}

/* =========================================================
   Vehicle expense
   ========================================================= */

async function recordVehicleExpense(
  input: {
    vehicleId: string;
    category: string;
    amountCents: number;
    occurredAt: string;
    vendor: string | null;
    note: string;
    idempotencyKey: string;
  },
): Promise<{
  expenseId: string;
}> {
  const { db } =
    getFirebaseClient();

  const actorUid =
    getActorUid();

  const operationRef =
    doc(
      db,
      "idempotencyKeys",
      `expense_${input.idempotencyKey}`,
    );

  const expenseRef =
    doc(
      collection(
        db,
        "vehicleExpenses",
      ),
    );

  const vehicleRef =
    doc(
      db,
      "vehicles",
      input.vehicleId,
    );

  await runTransaction(
    db,
    async (transaction) => {
      const previous =
        await transaction.get(
          operationRef,
        );

      if (previous.exists()) {
        return;
      }

      const vehicleSnapshot =
        await transaction.get(
          vehicleRef,
        );

      if (
        !vehicleSnapshot.exists()
      ) {
        throw new Error(
          "Vehicle was not found.",
        );
      }

      transaction.set(
        expenseRef,
        {
          vehicleId:
            input.vehicleId,

          category:
            input.category,

          amountCents:
            input.amountCents,

          occurredAt:
  asTimestamp(
    input.occurredAt,
  ),

          vendor:
            input.vendor,

          note:
            input.note,

          recordedBy:
            actorUid,

          recordedAt:
            nowTimestamp(),
        },
      );

      const ledgerRef =
        doc(
          collection(
            db,
            "financialLedger",
          ),
        );

      transaction.set(
        ledgerRef,
        {
          vehicleId:
            input.vehicleId,

          vehicleRegistration:
            vehicleSnapshot.get(
              "registrationNumber",
            ),

          entryType:
            "expense",

          amountCents:
            -input.amountCents,

          expenseId:
            expenseRef.id,

          occurredAt:
            nowTimestamp(),

          recordedBy:
            actorUid,
        },
      );

      transaction.set(
        operationRef,
        {
          response: {
            expenseId:
              expenseRef.id,
          },

          actorUid,

          createdAt:
            nowTimestamp(),
        },
      );
    },
  );

  return {
    expenseId:
      expenseRef.id,
  };
}

/* =========================================================
   Financial overview
   ========================================================= */

async function getFinancialOverview(
  input: {
    from: string;
    to: string;
    vehicleId: string | null;
  },
): Promise<FinancialOverview> {
  const { db } =
    getFirebaseClient();

  const [
    financialSnapshot,
    expenseSnapshot,
    ledgerSnapshot,
  ] = await Promise.all([
    getDocs(
      query(
        collection(
          db,
          "rentalFinancials",
        ),
        limit(500),
      ),
    ),

    getDocs(
      query(
        collection(
          db,
          "vehicleExpenses",
        ),
        limit(500),
      ),
    ),

    getDocs(
      query(
        collection(
          db,
          "financialLedger",
        ),
        limit(500),
      ),
    ),
  ]);

  const financialRecords:
    FirestoreDoc[] =
    financialSnapshot.docs.map(
      (snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
      }),
    );

  const expenses:
    FirestoreDoc[] =
    expenseSnapshot.docs.map(
      (snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
      }),
    );

  const ledgerEntries:
    FirestoreDoc[] =
    ledgerSnapshot.docs.map(
      (snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
      }),
    );

  const matchesVehicle =
    (record: FirestoreDoc): boolean =>
      !input.vehicleId ||
      String(
        record.vehicleId ?? "",
      ) === input.vehicleId;

  const fromDate =
    new Date(
      `${input.from}T00:00:00`,
    );

  const toDate =
    new Date(
      `${input.to}T23:59:59.999`,
    );

  const withinRange =
    (value: unknown) => {
      if (!value) {
        return false;
      }

      const date =
        new Date(
          toIso(value),
        );

      return (
        date >= fromDate &&
        date <= toDate
      );
    };

  const filteredFinancial =
    financialRecords.filter(
      (record) =>
        matchesVehicle(record) &&
        withinRange(
          record.createdAt ??
            record.pickupAt,
        ),
    );

  const filteredExpenses =
    expenses.filter(
      (record) =>
        matchesVehicle(record) &&
        withinRange(
          record.occurredAt,
        ),
    );

  const filteredLedger =
    ledgerEntries.filter(
      (entry) =>
        matchesVehicle(entry) &&
        withinRange(
          entry.occurredAt,
        ),
    );

  const invoicedCents =
    filteredFinancial.reduce(
      (
        sum,
        record,
      ) =>
        sum +
        Number(
          record.totalCents ??
            0,
        ),
      0,
    );

  const receivedCents =
    filteredFinancial.reduce(
      (
        sum,
        record,
      ) =>
        sum +
        Number(
          record.paidCents ??
            0,
        ),
      0,
    );

  const refundedCents =
    filteredFinancial.reduce(
      (
        sum,
        record,
      ) =>
        sum +
        Number(
          record.refundedCents ??
            0,
        ),
      0,
    );

  const expensesCents =
    filteredExpenses.reduce(
      (
        sum,
        record,
      ) =>
        sum +
        Number(
          record.amountCents ??
            0,
        ),
      0,
    );

  const netCashCents =
    receivedCents -
    refundedCents -
    expensesCents;

  const outstandingCents =
    filteredFinancial.reduce(
      (
        sum,
        record,
      ) =>
        sum +
        Number(
          record.outstandingCents ??
            0,
        ),
      0,
    );

  const vehicleMap =
    new Map<
      string,
      {
        vehicleRegistration: string;
        invoicedCents: number;
        expensesCents: number;
        receivedCents: number;
      }
    >();

  for (
    const record of
    filteredFinancial
  ) {
    const vehicleId =
      String(
        record.vehicleId ??
          "",
      );

    if (!vehicleId) {
      continue;
    }

    const current =
      vehicleMap.get(
        vehicleId,
      ) ?? {
        vehicleRegistration:
          String(
            record.vehicleRegistration ??
              record.vehicleRegistrationSnapshot ??
              vehicleId,
          ),

        invoicedCents: 0,

        expensesCents: 0,

        receivedCents: 0,
      };

    current.invoicedCents +=
      Number(
        record.totalCents ??
          0,
      );

    current.receivedCents +=
      Number(
        record.paidCents ??
          0,
      );

    vehicleMap.set(
      vehicleId,
      current,
    );
  }

  for (
    const expense of
    filteredExpenses
  ) {
    const vehicleId =
      String(
        expense.vehicleId ??
          "",
      );

    if (!vehicleId) {
      continue;
    }

    const current =
      vehicleMap.get(
        vehicleId,
      ) ?? {
        vehicleRegistration:
          vehicleId,

        invoicedCents: 0,

        expensesCents: 0,

        receivedCents: 0,
      };

    current.expensesCents +=
      Number(
        expense.amountCents ??
          0,
      );

    vehicleMap.set(
      vehicleId,
      current,
    );
  }

  const vehiclePerformance =
    Array.from(
      vehicleMap.entries(),
    ).map(
      ([
        vehicleId,
        item,
      ]) => ({
        vehicleId,

        vehicleRegistration:
          item.vehicleRegistration,

        invoicedCents:
          item.invoicedCents,

        expensesCents:
          item.expensesCents,

        receivedCents:
          item.receivedCents,

        operatingMarginCents:
          item.receivedCents -
          item.expensesCents,
      }),
    );

  const recentEntries =
    filteredLedger
      .sort(
        (a, b) =>
          new Date(
            toIso(
              b.occurredAt,
            ),
          ).getTime() -
          new Date(
            toIso(
              a.occurredAt,
            ),
          ).getTime(),
      )
      .slice(0, 20)
      .map(
        (entry) => ({
          id: entry.id,

          entryType:
            String(
              entry.entryType ??
                "entry",
            ),

          vehicleRegistration:
            String(
              entry.vehicleRegistration ??
                "",
            ),

          amountCents:
            Number(
              entry.amountCents ??
                0,
            ),

          occurredAt:
            toIso(
              entry.occurredAt,
            ),
        }),
      );

  const outstandingRentals =
    filteredFinancial.filter(
      (record) =>
        Number(
          record.outstandingCents ??
            0,
        ) > 0,
    ).length;

  return {
    from:
      input.from,

    to:
      input.to,

    vehicleId:
      input.vehicleId,

    invoicedCents,

    receivedCents,

    refundedCents,

    expensesCents,

    netCashCents,

    operatingMarginCents:
      receivedCents -
      refundedCents -
      expensesCents,

    outstandingCents,

    outstandingRentals,

    vehiclePerformance,

    recentEntries,
  };
}

/* =========================================================
   Compatibility dispatcher
   ========================================================= */

export async function callFirestoreOperation<
  TInput,
  TResult,
>(
  name: string,
  data: TInput,
): Promise<TResult> {
  switch (name) {
    case "getOperationalDashboard":
      return (
        (await getOperationalDashboard()) as TResult
      );
    case "getPayableRentals":
  return (
    (await getPayableRentals()) as TResult
  );
    case "getFinancialOverview":
      return (
        (await getFinancialOverview(
          data as {
            from: string;
            to: string;
            vehicleId: string | null;
          },
        )) as TResult
      );

    case "recordVehicleExpense":
      return (
        (await recordVehicleExpense(
          data as {
            vehicleId: string;
            category: string;
            amountCents: number;
            occurredAt: string;
            vendor:
              | string
              | null;
            note: string;
            idempotencyKey: string;
          },
        )) as TResult
      );

    case "createOrUpdateCustomer":
      return (
        (await createOrUpdateCustomer(
          data as Record<
            string,
            unknown
          >,
        )) as TResult
      );

    case "updateCustomerLicenceDocument":
      return (
        (await updateCustomerLicenceDocument(
          data as {
            customerId: string;
            licenceStoragePath: string;
          },
        )) as TResult
      );

    case "sendReservationContract":
      return (
        (await sendReservationContract(
          data as { reservationId: string },
        )) as TResult
      );

    case "createReservation":
      return (
        (await createReservation(
          data as {
            customerId: string;
            vehicleId: string;
            pickupAt: string;
            expectedReturnAt: string;
            pickupLocation: string | null;
            dropoffLocation: string | null;
            notes: string | null;
            bookingMedia: Array<
              Record<string, unknown>
            >;
            customerSignatureDataUrl: string;
          },
        )) as TResult
      );

    case "checkoutReservation":
      return (
        (await checkoutReservation(
          data as {
            reservationId: string;
            pickupFuelLevel: string;
            pickupOdometerKm: number;
            notes: string | null;
          },
        )) as TResult
      );

    case "extendRental":
      return (
        (await callTrustedFunction(
          "extendRental",
          data as {
            rentalId: string;
            expectedReturnAt: string;
            note: string;
            idempotencyKey: string;
          },
        )) as TResult
      );

    case "returnRental":
      return (
        (await returnRental(
          data as {
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
            returnMedia: Array<
              Record<string, unknown>
            >;
          },
        )) as TResult
      );

    case "recordRentalPayment":
      return (
        (await recordRentalPayment(
          data as {
            rentalId: string;
            amountCents: number;
            method: string;
            externalReference:
              | string
              | null;
            idempotencyKey: string;
          },
        )) as TResult
      );

    case "createVehicle":
      return (
        (await createVehicle(
          data as {
            registrationNumber: string;
            make: string;
            model: string;
            year: number | null;
            color: string | null;
            vin: string | null;
            registrationExpiresAt: string | null;
            insuranceExpiresAt: string | null;
            lastServiceAt: string | null;
            nextServiceDueAt: string | null;
            dailyCents: number | null;
            weeklyCents: number | null;
            monthlyCents: number | null;
            notes: string | null;
          },
        )) as TResult
      );

    case "updateVehicleDetails":
      await updateVehicleDetails(
        data as Record<
          string,
          unknown
        >,
      );

      return undefined as TResult;

    case "changeVehicleStatus":
      await changeVehicleStatus(
        data as {
          vehicleId: string;
          status: VehicleStatus;
          note: string;
        },
      );

      return undefined as TResult;

    default:
      throw new Error(
        `Unsupported rental operation: ${name}`,
      );
  }
}