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
  version: 2,
  approvedByNameSnapshot: "Dana Admin",

  customer: {
    fullName: "Riley <script>alert(1)</script>",
    telephone: "+1 555 0100",
    email: "riley@example.test",
    address: null,
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
  chargedDays: 2,
  baseRentalCents: 16000,

  rateSnapshot: {
    dailyCents: 8000,
    weeklyCents: null,
    monthlyCents: null,
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

    expect(
      snapshot.rateSnapshot.weeklyCents,
    ).toBeNull();

    expect(contractText(snapshot)).toContain(
      "Pickup location: Not recorded",
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
      "$160.00",
    );

    expect(contractText(snapshot)).toContain(
      "Contract version: 2",
    );

    expect(contractText(snapshot)).toContain(
      "Approved by: Dana Admin",
    );
  });
});
