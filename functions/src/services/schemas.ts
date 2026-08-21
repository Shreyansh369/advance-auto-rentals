import { z } from "zod";

export const MAX_MONEY_CENTS =
  10_000_000;

export const cents =
  z.number()
    .int()
    .nonnegative()
    .max(MAX_MONEY_CENTS);

export const isoDateTime =
  z.string().datetime({
    offset: true,
  });

export const id =
  z.string().regex(
    /^[A-Za-z0-9_-]{8,128}$/,
    "Invalid identifier",
  );

export const requestId =
  z.string().uuid();

export const fuelLevel =
  z.enum([
    "empty",
    "quarter",
    "half",
    "three_quarters",
    "full",
  ]);

export const customerSchema =
  z.object({
    customerId: id.optional(),

    fullName:
      z.string()
        .trim()
        .min(2)
        .max(160),

    telephone:
      z.string()
        .trim()
        .min(5)
        .max(40),

    email:
      z.string()
        .trim()
        .email()
        .max(254)
        .nullable(),

    address:
      z.string()
        .trim()
        .min(5)
        .max(500)
        .nullable(),

    licenceNumber:
      z.string()
        .trim()
        .min(3)
        .max(80),

    licenceCountry:
      z.string()
        .trim()
        .length(2)
        .toUpperCase(),

    licenceExpiresAt:
      z.string().date(),

    dateOfBirth:
      z.string()
        .date()
        .nullable(),

    notes:
      z.string()
        .trim()
        .max(2_000)
        .nullable(),

    licenceStoragePath:
      z.string()
        .regex(
          /^customer-documents\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/,
        )
        .nullable(),
  })
  .strict();

export const reservationSchema =
  z.object({
    customerId: id,

    vehicleId: id,

    pickupAt: isoDateTime,

    expectedReturnAt:
      isoDateTime,

    notes:
      z.string()
        .trim()
        .max(2_000)
        .nullable()
        .default(null),
  })
  .strict();

export const checkoutSchema =
  z.object({
    reservationId: id,

    pickupFuelLevel:
      fuelLevel,

    pickupOdometerKm:
      z.number()
        .int()
        .nonnegative()
        .max(10_000_000),

    notes:
      z.string()
        .trim()
        .max(2_000)
        .nullable()
        .default(null),
  })
  .strict();

export const adjustmentSchema =
  z.object({
    type: z.enum([
      "discount",
      "late_fee",
      "fuel",
      "cleaning",
      "damage",
      "car_seat",
      "pickup_dropoff",
      "insurance",
      "other",
    ]),

    amountCents:
      cents,

    note:
      z.string()
        .trim()
        .min(1)
        .max(500),
  })
  .strict();

export const returnSchema =
  z.object({
    rentalId: id,

    actualReturnAt:
      isoDateTime,

    returnFuelLevel:
      fuelLevel,

    returnOdometerKm:
      z.number()
        .int()
        .nonnegative()
        .max(10_000_000),

    adjustments:
      z.array(
        adjustmentSchema,
      )
      .max(30)
      .default([]),

    notes:
      z.string()
        .trim()
        .max(2_000)
        .nullable()
        .default(null),

    returnMedia:
      z.array(
        z.record(
          z.string(),
          z.unknown(),
        ),
      )
      .max(20)
      .default([]),
  })
  .strict();

export const extensionSchema =
  z.object({
    rentalId: id,

    expectedReturnAt:
      isoDateTime,

    note:
      z.string()
        .trim()
        .min(1)
        .max(500),

    idempotencyKey:
      requestId,
  })
  .strict();

export const paymentSchema =
  z.object({
    rentalId: id,

    amountCents:
      cents.refine(
        (value) => value > 0,
        "Amount must be positive",
      ),

    kind:
      z.enum([
        "payment",
        "deposit",
      ])
      .default("payment"),

    method:
      z.enum([
        "cash",
        "card",
        "bank_transfer",
        "other",
      ]),

    externalReference:
      z.string()
        .trim()
        .max(200)
        .nullable()
        .default(null),

    idempotencyKey:
      requestId,
  })
  .strict();

export const refundSchema =
  z.object({
    rentalId: id,

    amountCents:
      cents.refine(
        (value) => value > 0,
        "Amount must be positive",
      ),

    source:
      z.enum([
        "payment",
        "deposit",
      ])
      .default("payment"),

    reason:
      z.string()
        .trim()
        .min(3)
        .max(500),

    idempotencyKey:
      requestId,
  })
  .strict();

export const rateSchema =
  z.object({
    vehicleId: id,

    dailyCents:
      cents.nullable(),

    weeklyCents:
      cents.nullable(),

    monthlyCents:
      cents.nullable(),
  })
  .strict()
  .refine(
    (data) =>
      data.dailyCents !== null ||
      data.weeklyCents !== null ||
      data.monthlyCents !== null,
    "At least one rate is required",
  );

export const vehicleStatusSchema =
  z.object({
    vehicleId: id,

    status:
      z.enum([
        "available",
        "reserved",
        "rented",
        "overdue",
        "cleaning",
        "maintenance",
        "out_of_service",
      ]),

    note:
      z.string()
        .trim()
        .min(1)
        .max(500),
  })
  .strict();

export const vehicleUpdateSchema =
  z.object({
    vehicleId: id,

    registrationNumber:
      z.string()
        .trim()
        .min(1)
        .max(40),

    make:
      z.string()
        .trim()
        .min(1)
        .max(80),

    model:
      z.string()
        .trim()
        .min(1)
        .max(120),

    year:
      z.number()
        .int()
        .min(1886)
        .max(
          new Date().getUTCFullYear() + 1,
        )
        .nullable(),

    color:
      z.string()
        .trim()
        .max(60)
        .nullable(),

    vin:
      z.string()
        .trim()
        .length(17)
        .toUpperCase()
        .nullable(),

    registrationExpiresAt:
      z.string()
        .date()
        .nullable(),

    insuranceExpiresAt:
      z.string()
        .date()
        .nullable(),

    lastServiceAt:
      z.string()
        .date()
        .nullable(),

    nextServiceDueAt:
      z.string()
        .date()
        .nullable(),

    dailyCents:
      cents.nullable(),

    weeklyCents:
      cents.nullable(),

    monthlyCents:
      cents.nullable(),

    notes:
      z.string()
        .trim()
        .max(2_000)
        .nullable(),
  })
  .strict()
  .refine(
    (data) =>
      data.dailyCents !== null ||
      data.weeklyCents !== null ||
      data.monthlyCents !== null,
    "At least one rate is required",
  );

export const serviceSchema =
  z.object({
    vehicleId: id,

    completedAt:
      isoDateTime,

    nextServiceDueAt:
      isoDateTime.nullable(),

    description:
      z.string()
        .trim()
        .min(3)
        .max(1_000),

    odometerKm:
      z.number()
        .int()
        .nonnegative()
        .max(10_000_000)
        .nullable()
        .default(null),
  })
  .strict();

export const expenseSchema =
  z.object({
    vehicleId: id,

    category:
      z.enum([
        "repair",
        "service",
        "maintenance",
        "parts",
        "other",
      ]),

    amountCents:
      cents.refine(
        (value) => value > 0,
      ),

    occurredAt:
      isoDateTime,

    vendor:
      z.string()
        .trim()
        .min(2)
        .max(160)
        .nullable()
        .default(null),

    note:
      z.string()
        .trim()
        .min(1)
        .max(1_000),

    idempotencyKey:
      requestId,
  })
  .strict();

export const inspectionSchema =
  z.object({
    rentalId: id,

    stage:
      z.enum([
        "pickup",
        "return",
      ]),

    conditionNotes:
      z.string()
        .trim()
        .max(2_000)
        .nullable()
        .default(null),

    damageNotes:
      z.string()
        .trim()
        .max(2_000)
        .nullable()
        .default(null),

    photoPaths:
      z.array(
        z.string().regex(
          /^inspection-photos\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/,
        ),
      )
      .max(20)
      .default([]),
  })
  .strict();

export const financialOverviewSchema =
  z.object({
    from:
      z.string().date(),

    to:
      z.string().date(),
  })
  .strict()
  .refine(
    (input) =>
      input.from <= input.to,
    "The reporting period is invalid",
  );