import { describe, expect, it } from "vitest";

import {
  contractHtml,
  contractSubject,
  contractText,
  escapeHtml,
  readSnapshot,
  SnapshotError,
} from "../../services/contract-mailer/src/contract-email";

import {
  ConfigurationError,
  readEnv,
} from "../../services/contract-mailer/src/env";

import {
  decodeFields,
  encodeFields,
} from "../../services/contract-mailer/src/firestore-rest";

import {
  AGREEMENT_NOTICES as MAILER_NOTICES,
  AGREEMENT_TERMS as MAILER_TERMS,
  CHARGE_ROWS as MAILER_CHARGE_ROWS,
  COMPANY as MAILER_COMPANY,
  GAS_LEVELS as MAILER_GAS_LEVELS,
  PAYMENT_METHODS as MAILER_PAYMENT_METHODS,
} from "../../services/contract-mailer/src/agreement";

import {
  AGREEMENT_NOTICES,
  AGREEMENT_TERMS,
  CHARGE_ROWS,
  COMPANY,
  GAS_LEVELS,
  PAYMENT_METHODS,
} from "../../lib/agreement";

const settings = {
  FIREBASE_PROJECT_ID: "advance-auto",
  FIREBASE_API_KEY: "public-web-key",
  RESEND_API_KEY: "secret",
  CONTRACT_FROM_EMAIL: "Advance Auto <contracts@example.test>",
  CONTRACT_MAILER_ALLOWED_ORIGINS:
    "https://a.example.test, https://b.example.test",
};

describe("mailer configuration", () => {
  it("reads the origins allowlist and defaults the service URLs", () => {
    const env = readEnv(settings);

    expect(env.allowedOrigins).toEqual([
      "https://a.example.test",
      "https://b.example.test",
    ]);

    expect(env.replyToEmail).toBeNull();

    expect(env.firestoreBaseUrl).toBe(
      "https://firestore.googleapis.com",
    );

    expect(env.resendBaseUrl).toBe(
      "https://api.resend.com",
    );
  });

  it("refuses to start without the provider credential", () => {
    expect(() =>
      readEnv({
        ...settings,
        RESEND_API_KEY: "",
      }),
    ).toThrow(ConfigurationError);
  });
});

describe("Firestore REST encoding", () => {
  it("round-trips the shapes a delivery receipt uses", () => {
    const original = {
      recipientEmail: "riley@example.test",
      contractVersion: 3,
      failureReason: null,
      delivered: true,
      rate: 12.5,
      customer: { fullName: "Riley" },
      tags: ["contract", "sent"],
    };

    expect(
      decodeFields(encodeFields(original)),
    ).toEqual(original);
  });
});

const snapshotFields = {
  reservationId: "res_1",
  rentalId: "rent_1",
  version: 2,
  approvedByNameSnapshot: "Dana Admin",

  customer: {
    fullName: "Riley <script>alert(1)</script>",
    telephone: "+1 555 0100",
    email: "riley@example.test",
    address: null,
    state: "Tortola",
    localAddress: null,
    dateOfBirth: "1990-04-02",
    licenceNumber: "D1234567",
    licenceCountry: "US",
    licenceExpiresAt: "2030-01-01",
  },

  vehicle: {
    registration: "RT-900",
    make: "Toyota",
    model: "Corolla",
    year: 2023,
    color: null,
    vin: null,
  },

  pickupAt: "2026-09-10T14:00:00.000Z",
  expectedReturnAt: "2026-09-12T14:00:00.000Z",
  pickupLocation: null,
  dropoffLocation: null,
  notes: "Second driver approved.",
  preparedBy: "Sam Operations",

  agreement: {
    dateOut: "2026-09-10T14:00:00.000Z",
    dateIn: "2026-09-12T14:00:00.000Z",
    actualTimeIn: null,
    odometerOut: { value: 42000, unit: "km" },
    odometerIn: null,
    gasOut: "quarter",
    gasIn: null,
    extraHours: 0,
    depositCents: 30000,

    waivers: {
      liabilityWaiver: true,
      windscreenWaiver: false,
      personalAccidentInsurance: false,
    },

    charges: {
      daily: 16000,
      detailing: 12000,
    },

    chargeTotalCents: 28000,
    paymentMethod: "credit",
    paymentReferenceLast4: "4242",
    paymentHolderName: "Riley Customer",
    specialInstructions: null,
    additionalDriver: null,
    checkedOutBy: "Sam Operations",
  },

  signedByNameSnapshot: "Riley",
  signatureMethod: "drawn",
  signatureCapturedAt: "2026-09-01T09:30:00.000Z",
};

describe("contract rendering", () => {
  it("refuses to render when the approved version is missing", () => {
    expect(() => readSnapshot(null)).toThrow(
      SnapshotError,
    );
  });

  it("keeps missing optional values as explicit gaps", () => {
    const snapshot = readSnapshot(snapshotFields);

    expect(snapshot.customer.address).toBeNull();
    expect(snapshot.vehicle.vin).toBeNull();

    expect(snapshot.odometerIn).toBeNull();

    expect(contractText(snapshot)).toContain(
      "Pickup location: Not recorded",
    );

    expect(contractText(snapshot)).toContain(
      "Gas in: Not recorded",
    );
  });

  it("escapes text that came from a person", () => {
    const html = contractHtml(
      readSnapshot(snapshotFields),
    );

    expect(html).not.toContain(
      "<script>alert(1)</script>",
    );

    expect(html).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );

    expect(escapeHtml(`a"b'c&d`)).toBe(
      "a&quot;b&#39;c&amp;d",
    );
  });

  it("says a typed acceptance was typed rather than signed", () => {
    const drawn = readSnapshot(snapshotFields);

    expect(contractText(drawn)).toContain(
      "Signed by: Riley",
    );

    const typed = readSnapshot({
      ...snapshotFields,
      signatureMethod: "typed",
    });

    expect(contractText(typed)).toContain(
      "Accepted by: Riley",
    );

    expect(contractText(typed)).not.toContain(
      "Signed by:",
    );

    expect(contractHtml(typed)).toContain(
      "Accepted by",
    );
  });

  it("treats a booking taken before the option existed as drawn", () => {
    const legacy = readSnapshot({
      ...snapshotFields,
      signatureMethod: null,
    });

    expect(legacy.signatureMethod).toBe(
      "drawn",
    );
  });

  it("states the money and the version the administrator approved", () => {
    const snapshot = readSnapshot(snapshotFields);

    expect(contractSubject(snapshot)).toBe(
      "Rental agreement res_1 — RT-900",
    );

    expect(contractHtml(snapshot)).toContain(
      "$280.00",
    );

    expect(contractText(snapshot)).toContain(
      "Contract version: 2",
    );

    expect(contractText(snapshot)).toContain(
      "Approved by: Dana Admin",
    );
  });
});

describe("the emailed agreement is the client's form", () => {
  const snapshot = readSnapshot(snapshotFields);

  it("carries every block the printed form has", () => {
    const html = contractHtml(snapshot);

    for (const heading of [
      "Renter",
      "Vehicle",
      "Rental period",
      "Waivers and deposit",
      "Charges",
      "Payment information",
      "Agreement",
    ]) {
      expect(html).toContain(heading);
    }

    expect(html).toContain("42000 km");
    expect(html).toContain("¼ tank");
    expect(html).toContain("$300.00");
  });

  it("prints the charge rows and the total the office agreed", () => {
    const text = contractText(snapshot);

    expect(text).toContain("Daily: $160.00");

    expect(text).toContain(
      "Detailing / cleaning: $120.00",
    );

    /* Rows left at zero are omitted, not padded. */
    expect(text).not.toContain("Weekly:");

    expect(text).toContain("TOTAL: $280.00");
  });

  it("sends the full terms, so the renter has what they signed", () => {
    const text = contractText(snapshot);

    for (const clause of AGREEMENT_TERMS) {
      expect(text).toContain(clause);
    }

    expect(text).toContain(
      AGREEMENT_NOTICES.acknowledgement,
    );

    expect(contractHtml(snapshot)).toContain(
      "Terms &amp; conditions",
    );
  });

  it("records only the last four digits of the card", () => {
    const text = contractText(snapshot);

    expect(text).toContain("**** 4242");
    expect(text).not.toContain("Riley Customer\n");

    expect(contractHtml(snapshot)).toContain(
      "4242",
    );
  });

  it("includes the additional renter only when there is one", () => {
    expect(contractHtml(snapshot)).not.toContain(
      "Additional renter",
    );

    const withDriver = readSnapshot({
      ...snapshotFields,

      agreement: {
        ...snapshotFields.agreement,

        additionalDriver: {
          fullName: "Jordan Second",
          telephone: "+1 555 0111",
          address: null,
          state: null,
          localAddress: null,
          dateOfBirth: null,
          licenceNumber: "D9999999",
          licenceExpiresAt: null,
        },
      },
    });

    expect(
      contractHtml(withDriver),
    ).toContain("Additional renter");

    expect(
      contractText(withDriver),
    ).toContain("Jordan Second");
  });

  /*
   * Contracts approved before the agreement moved to
   * checkout have no agreement block at all. Those still
   * have to render — the office can reopen any of them.
   */
  it("still renders a contract approved before checkout carried the agreement", () => {
    const legacy = readSnapshot({
      reservationId: "res_old",
      version: 1,
      approvedByNameSnapshot: "Dana Admin",
      customer: snapshotFields.customer,
      vehicle: snapshotFields.vehicle,
      pickupAt: "2026-01-02T10:00:00.000Z",
      expectedReturnAt:
        "2026-01-04T10:00:00.000Z",
      preparedBy: "Sam Operations",
      signedByNameSnapshot: "Riley",
      signatureMethod: "drawn",
      signatureCapturedAt: null,
    });

    expect(legacy.chargeTotalCents).toBe(0);
    expect(legacy.additionalDriver).toBeNull();

    /* The booking's own dates stand in. */
    expect(
      contractText(legacy),
    ).toContain("Jan 2, 2026");

    expect(() =>
      contractHtml(legacy),
    ).not.toThrow();
  });
});

/*
 * The mailer deploys as its own project and carries its own
 * copy of the agreement wording. A copy that drifts would
 * email a renter terms the business never printed, so the two
 * are compared here rather than trusted.
 */
describe("the mailer's copy of the agreement", () => {
  it("matches the application's wording exactly", () => {
    expect(MAILER_TERMS).toEqual(
      AGREEMENT_TERMS,
    );

    expect(MAILER_COMPANY).toEqual(COMPANY);

    expect(MAILER_NOTICES).toEqual(
      AGREEMENT_NOTICES,
    );

    expect(MAILER_CHARGE_ROWS).toEqual(
      CHARGE_ROWS,
    );

    expect(MAILER_GAS_LEVELS).toEqual(
      GAS_LEVELS,
    );

    expect(MAILER_PAYMENT_METHODS).toEqual(
      PAYMENT_METHODS,
    );
  });

  it("still carries the clauses the renter agrees to", () => {
    expect(MAILER_TERMS).toHaveLength(14);

    expect(MAILER_TERMS[0]).toContain(
      "LIABILITY INSURANCE",
    );
  });
});
