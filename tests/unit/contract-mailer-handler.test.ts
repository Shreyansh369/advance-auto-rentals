import { describe, expect, it } from "vitest";

import { readEnv } from "../../services/contract-mailer/src/env";

import { handleSendContract } from "../../services/contract-mailer/src/handler";

import {
  encodeFields,
  type FirestoreValue,
} from "../../services/contract-mailer/src/firestore-rest";

import { AGREEMENT_TERMS } from "../../lib/agreement";

/*
 * The endpoint end to end, with Google's identity toolkit,
 * Firestore and the mail provider all standing in.
 *
 * Everything between the browser's request and the provider
 * call is the real code, so this is what actually proves the
 * agreement reaches the provider, addressed to the customer
 * on file and carrying what the administrator approved.
 */
const env = readEnv({
  FIREBASE_PROJECT_ID: "advance-auto",
  FIREBASE_API_KEY: "public-web-key",
  RESEND_API_KEY: "secret",
  CONTRACT_FROM_EMAIL:
    "Advance Auto <contracts@advanceauto.test>",
  CONTRACT_MAILER_ALLOWED_ORIGINS:
    "https://desk.example.test",
});

const approvedVersion = {
  reservationId: "res_1",
  rentalId: "rent_1",
  version: 2,
  approvedByNameSnapshot: "Dana Admin",

  customer: {
    fullName: "Riley Customer",
    telephone: "+1 555 0100",
    email: "riley@example.test",
    address: "12 Harbour Road",
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
    color: "Silver",
    vin: null,
  },

  pickupAt: "2026-09-10T14:00:00.000Z",
  expectedReturnAt: "2026-09-12T14:00:00.000Z",
  pickupLocation: "Downtown office",
  dropoffLocation: "Airport terminal",
  notes: null,
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

    charges: { daily: 16000, detailing: 12000 },
    chargeTotalCents: 28000,
    paymentMethod: "credit",
    paymentReferenceLast4: "4242",
    paymentHolderName: "Riley Customer",
    specialInstructions: null,
    additionalDriver: null,
    checkedOutBy: "Sam Operations",
  },

  signedByNameSnapshot: "Riley Customer",
  signatureMethod: "typed",
  signatureCapturedAt:
    "2026-09-10T14:05:00.000Z",
};

type Fields = Record<string, FirestoreValue>;

type Stub = {
  contract?: Fields | null;
  profile?: Fields | null;
  providerStatus?: number;
  providerBody?: Record<string, unknown>;
};

function harness(stub: Stub = {}) {
  const calls: Array<{
    url: string;
    body: Record<string, unknown> | null;
  }> = [];

  const profile = stub.profile ?? {
    role: "operations",
    status: "approved",
    fullName: "Sam Operations",
    email: "ops@example.test",
  };

  const contract =
    stub.contract === undefined
      ? {
          status: "approved",
          approvedVersion: 2,
        }
      : stub.contract;

  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);

    const body = init?.body
      ? (JSON.parse(
          String(init.body),
        ) as Record<string, unknown>)
      : null;

    calls.push({ url, body });

    const ok = (payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });

    const document = (fields: Fields | null) =>
      fields
        ? ok({ fields: encodeFields(fields) })
        : new Response("{}", { status: 404 });

    if (url.includes("accounts:lookup")) {
      return ok({
        users: [
          {
            localId: "uid_ops",
            email: "ops@example.test",
          },
        ],
      });
    }

    if (url.includes("/users/uid_ops")) {
      return document(profile);
    }

    if (url.includes("/versions/v2")) {
      return document(approvedVersion);
    }

    if (url.includes("/deliveries")) {
      return ok({});
    }

    if (
      url.includes(
        "/reservationContracts/res_1",
      )
    ) {
      return document(contract);
    }

    if (url.endsWith("/emails")) {
      return new Response(
        JSON.stringify(
          stub.providerBody ?? {
            id: "msg_abc123",
          },
        ),
        {
          status: stub.providerStatus ?? 200,
          headers: {
            "Content-Type":
              "application/json",
          },
        },
      );
    }

    throw new Error(`unstubbed call: ${url}`);
  }) as typeof fetch;

  const request = new Request(
    "https://mailer.example.test/api/send-contract",
    {
      method: "POST",

      headers: {
        Authorization: "Bearer id-token",
        "Content-Type": "application/json",
        Origin: "https://desk.example.test",
      },

      body: JSON.stringify({
        reservationId: "res_1",
      }),
    },
  );

  return {
    calls,

    run: () =>
      handleSendContract(request, env, {
        fetchImpl,
        now: () =>
          new Date("2026-09-14T09:00:00.000Z"),
        newId: () => "delivery_1",
      }),

    sent: () =>
      calls.find((call) =>
        call.url.endsWith("/emails"),
      ),

    receipt: () =>
      calls.find((call) =>
        call.url.includes("/deliveries"),
      ),
  };
}

describe("the contract mailer endpoint", () => {
  it("sends the approved agreement to the customer on file", async () => {
    const test = harness();
    const response = await test.run();

    expect(response.status).toBe(200);

    await expect(
      response.json(),
    ).resolves.toMatchObject({
      status: "sent",
      providerMessageId: "msg_abc123",
      recipientEmail: "riley@example.test",
      contractVersion: 2,
    });

    const sent = test.sent();

    expect(sent).toBeDefined();

    expect(sent?.body?.to).toEqual([
      "riley@example.test",
    ]);

    expect(sent?.body?.from).toBe(
      "Advance Auto <contracts@advanceauto.test>",
    );

    expect(sent?.body?.subject).toBe(
      "Rental agreement res_1 — RT-900",
    );
  });

  it("sends the client's form, not a summary of the booking", async () => {
    const test = harness();

    await test.run();

    const html = String(
      test.sent()?.body?.html ?? "",
    );

    const text = String(
      test.sent()?.body?.text ?? "",
    );

    for (const fragment of [
      "Riley Customer",
      "RT-900",
      "42000 km",
      "$300.00",
      "$280.00",
      "4242",
    ]) {
      expect(html).toContain(fragment);
    }

    /* The terms travel with it: the renter receives what
       they agreed to, not a receipt. */
    expect(html).toContain(
      "Terms &amp; conditions",
    );

    for (const clause of AGREEMENT_TERMS) {
      expect(text).toContain(clause);
    }

    expect(text).toContain(
      "Accepted by: Riley Customer",
    );
  });

  it("records a receipt against the version that was sent", async () => {
    const test = harness();

    await test.run();

    const receipt = test.receipt();

    expect(receipt?.url).toContain(
      "documentId=delivery_1",
    );

    const fields = (
      receipt?.body as {
        fields: Record<
          string,
          Record<string, unknown>
        >;
      }
    ).fields;

    expect(fields.status.stringValue).toBe(
      "sent",
    );

    expect(
      fields.providerMessageId.stringValue,
    ).toBe("msg_abc123");

    expect(
      fields.contractVersion.integerValue,
    ).toBe("2");

    expect(
      fields.recipientEmail.stringValue,
    ).toBe("riley@example.test");

    expect(
      fields.sentByNameSnapshot.stringValue,
    ).toBe("Sam Operations");
  });

  /*
   * A contract that could not be delivered is a fact the
   * office needs to see, so the failure is recorded rather
   * than swallowed.
   */
  it("records a refusal from the provider and reports it", async () => {
    const test = harness({
      providerStatus: 422,

      providerBody: {
        message:
          "The domain is not verified.",
      },
    });

    const response = await test.run();

    expect(response.status).toBe(502);

    await expect(
      response.json(),
    ).resolves.toMatchObject({
      status: "failed",
      error: "The domain is not verified.",
    });

    const fields = (
      test.receipt()?.body as {
        fields: Record<
          string,
          Record<string, unknown>
        >;
      }
    ).fields;

    expect(fields.status.stringValue).toBe(
      "failed",
    );

    expect(
      fields.failureReason.stringValue,
    ).toBe("The domain is not verified.");
  });

  it("refuses to send a contract nobody approved", async () => {
    const test = harness({
      contract: {
        status: "in_review",
        approvedVersion: null,
      },
    });

    const response = await test.run();

    expect(response.status).toBe(409);
    expect(test.sent()).toBeUndefined();
  });

  it("refuses an account that is not approved staff", async () => {
    const test = harness({
      profile: {
        role: "operations",
        status: "pending",
        fullName: "Sam Operations",
      },
    });

    const response = await test.run();

    expect(response.status).toBe(403);
    expect(test.sent()).toBeUndefined();
  });
});
