import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

import { doc, getDocs, collection, setDoc } from "firebase/firestore";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import type { MailerEnv } from "../../services/contract-mailer/src/env";
import { handleSendContract } from "../../services/contract-mailer/src/handler";

/*
 * The mailer runs against the real Firebase emulators here,
 * with a stand-in for Resend. Nothing about the request path
 * is mocked: a real ID token is minted by the auth emulator,
 * the endpoint verifies it through the identity toolkit, and
 * every read and write goes through the Firestore REST API
 * under the security rules this repository ships.
 */
const PROJECT_ID = "advance-auto-rentals-test";
const API_KEY = "fake-api-key";
const ORIGIN = "https://rentals.example.test";

const RESERVATION = "mailer_reservation";
const UNAPPROVED = "mailer_unapproved";
const NO_EMAIL = "mailer_no_email";
const FAILING = "mailer_failing";

const firestoreHost =
  process.env.FIRESTORE_EMULATOR_HOST ??
  "127.0.0.1:8080";

const authHost =
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??
  "127.0.0.1:9099";

let testEnv: RulesTestEnvironment;
let resendServer: Server;
let resendBaseUrl: string;
let resendRequests: Array<Record<string, unknown>>;
let resendStatus: number;
let resendBody: Record<string, unknown>;

let staffToken: string;
let staffUid: string;
let strangerToken: string;

async function mintToken(
  email: string,
): Promise<{ idToken: string; uid: string }> {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "not-a-real-password",
        returnSecureToken: true,
      }),
    },
  );

  const body = (await response.json()) as {
    idToken?: string;
    localId?: string;
  };

  if (!body.idToken || !body.localId) {
    throw new Error(
      `The auth emulator did not mint a token: ${JSON.stringify(body)}`,
    );
  }

  return { idToken: body.idToken, uid: body.localId };
}

function env(): MailerEnv {
  return {
    projectId: PROJECT_ID,
    apiKey: API_KEY,
    resendApiKey: "test-resend-key",
    fromEmail: "Advance Auto <contracts@example.test>",
    replyToEmail: "office@example.test",
    staffNotificationEmails: [
      "admin@example.test",
    ],
    appBaseUrl: ORIGIN,
    allowedOrigins: [ORIGIN],
    firestoreBaseUrl: `http://${firestoreHost}`,
    identityBaseUrl: `http://${authHost}/identitytoolkit.googleapis.com`,
    resendBaseUrl,
  };
}

function request(options: {
  token?: string;
  body?: unknown;
  method?: string;
  origin?: string;
}): Request {
  return new Request(
    "https://mailer.example.test/api/send-contract",
    {
      method: options.method ?? "POST",

      headers: {
        "Content-Type": "application/json",
        Origin: options.origin ?? ORIGIN,

        ...(options.token
          ? { Authorization: `Bearer ${options.token}` }
          : {}),
      },

      ...(options.method === "OPTIONS"
        ? {}
        : { body: JSON.stringify(options.body ?? {}) }),
    },
  );
}

function snapshotFor(reservationId: string) {
  return {
    reservationId,
    version: 1,
    approvedBy: "admin-user",
    approvedByNameSnapshot: "Dana Admin",
    approvedAt: "2026-09-01T10:00:00.000Z",

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
      vin: "VIN900",
    },

    pickupAt: "2026-09-10T14:00:00.000Z",
    expectedReturnAt: "2026-09-12T14:00:00.000Z",
    pickupLocation: "Downtown office",
    dropoffLocation: "Airport terminal",
    notes: null,
    preparedBy: "Sam Operations",
    rentalId: "mailer_rental",

    /* What checkout captured, as `reviewContract` freezes it
       onto the approved version. */
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

    signedByNameSnapshot: "Riley Customer",
    signatureMethod: "typed",
    signatureCapturedAt: "2026-09-01T09:30:00.000Z",
  };
}

beforeAll(async () => {
  resendRequests = [];
  resendStatus = 200;
  resendBody = { id: "msg_stub_1" };

  resendServer = createServer((incoming, response) => {
    const chunks: Buffer[] = [];

    incoming.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    incoming.on("end", () => {
      try {
        resendRequests.push(
          JSON.parse(Buffer.concat(chunks).toString()),
        );
      } catch {
        resendRequests.push({});
      }

      response.writeHead(resendStatus, {
        "Content-Type": "application/json",
      });

      response.end(JSON.stringify(resendBody));
    });
  });

  await new Promise<void>((resolve) => {
    resendServer.listen(0, "127.0.0.1", resolve);
  });

  const address = resendServer.address();

  if (!address || typeof address === "string") {
    throw new Error("The stub mail provider did not start.");
  }

  resendBaseUrl = `http://127.0.0.1:${address.port}`;

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });

  const staff = await mintToken(
    `mailer-staff-${Date.now()}@example.test`,
  );

  staffToken = staff.idToken;
  staffUid = staff.uid;

  const stranger = await mintToken(
    `mailer-stranger-${Date.now()}@example.test`,
  );

  strangerToken = stranger.idToken;

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, "users", staffUid), {
      email: "mailer-staff@example.test",
      fullName: "Sam Operations",
      role: "operations",
      status: "approved",
      requestedRole: "operations",
    });

    await setDoc(doc(db, "users", stranger.uid), {
      email: "mailer-stranger@example.test",
      role: null,
      status: "pending",
      requestedRole: "operations",
    });

    /* An approved contract with a frozen version. */
    await setDoc(doc(db, "reservationContracts", RESERVATION), {
      status: "approved",
      version: 1,
      approvedVersion: 1,
    });

    await setDoc(
      doc(db, "reservationContracts", RESERVATION, "versions", "v1"),
      snapshotFor(RESERVATION),
    );

    /* Submitted but not yet decided. */
    await setDoc(doc(db, "reservationContracts", UNAPPROVED), {
      status: "in_review",
      version: 1,
    });

    /* Approved, but the customer has no address to send to. */
    await setDoc(doc(db, "reservationContracts", NO_EMAIL), {
      status: "approved",
      version: 1,
      approvedVersion: 1,
    });

    await setDoc(
      doc(db, "reservationContracts", NO_EMAIL, "versions", "v1"),
      {
        ...snapshotFor(NO_EMAIL),
        customer: {
          ...snapshotFor(NO_EMAIL).customer,
          email: null,
        },
      },
    );

    /* Used for the provider-failure case. */
    await setDoc(doc(db, "reservationContracts", FAILING), {
      status: "approved",
      version: 1,
      approvedVersion: 1,
    });

    await setDoc(
      doc(db, "reservationContracts", FAILING, "versions", "v1"),
      snapshotFor(FAILING),
    );
  });
});

afterAll(async () => {
  await testEnv.cleanup();

  await new Promise<void>((resolve) => {
    resendServer.close(() => resolve());
  });
});

async function deliveries(reservationId: string) {
  let records: Array<Record<string, unknown>> = [];

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const snapshot = await getDocs(
      collection(
        context.firestore(),
        "reservationContracts",
        reservationId,
        "deliveries",
      ),
    );

    records = snapshot.docs.map((entry) => entry.data());
  });

  return records;
}

describe("contract mailer endpoint", () => {
  it("emails an approved contract and records the receipt", async () => {
    const response = await handleSendContract(
      request({
        token: staffToken,

        /*
         * The browser also sends a recipient and a total. The
         * endpoint must ignore both and use the approved
         * snapshot instead.
         */
        body: {
          reservationId: RESERVATION,
          recipientEmail: "attacker@example.test",
          baseRentalCents: 1,
        },
      }),
      env(),
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;

    expect(body).toMatchObject({
      status: "sent",
      providerMessageId: "msg_stub_1",
      recipientEmail: "riley@example.test",
      contractVersion: 1,
    });

    expect(
      response.headers.get("Access-Control-Allow-Origin"),
    ).toBe(ORIGIN);

    const sent = resendRequests.at(-1) as {
      to?: string[];
      html?: string;
      text?: string;
      from?: string;
    };

    expect(sent.to).toEqual(["riley@example.test"]);
    expect(sent.from).toBe(
      "Advance Auto <contracts@example.test>",
    );

    /* The money in the email is the approved figure, not the
       one the request tried to substitute. */
    expect(sent.text).toContain("Daily: $160.00");
    expect(sent.text).toContain("TOTAL: $280.00");
    expect(sent.html).toContain("$280.00");
    expect(sent.html).toContain("RT-900");

    /* It is the client's form that goes out, filled in. */
    expect(sent.text).toContain("KM out: 42000 km");
    expect(sent.text).toContain("Deposit: $300.00");
    expect(sent.text).toContain("**** 4242");

    expect(sent.text).toContain(
      "Accepted by: Riley Customer",
    );

    const records = await deliveries(RESERVATION);

    expect(records).toHaveLength(1);

    expect(records[0]).toMatchObject({
      status: "sent",
      provider: "resend",
      providerMessageId: "msg_stub_1",
      recipientEmail: "riley@example.test",
      recipientNameSnapshot: "Riley Customer",
      contractVersion: 1,
      sentBy: staffUid,
      sentByNameSnapshot: "Sam Operations",
      failureReason: null,
    });

    expect(
      String(records[0].sentAt),
    ).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("refuses a request that presents no session", async () => {
    const response = await handleSendContract(
      request({ body: { reservationId: RESERVATION } }),
      env(),
    );

    expect(response.status).toBe(401);
  });

  it("refuses a signed-in account that is not approved staff", async () => {
    const response = await handleSendContract(
      request({
        token: strangerToken,
        body: { reservationId: RESERVATION },
      }),
      env(),
    );

    expect(response.status).toBe(403);
  });

  it("refuses a contract that no administrator has approved", async () => {
    const response = await handleSendContract(
      request({
        token: staffToken,
        body: { reservationId: UNAPPROVED },
      }),
      env(),
    );

    expect(response.status).toBe(409);

    expect(await deliveries(UNAPPROVED)).toHaveLength(0);
  });

  it("refuses a booking reference that has no contract at all", async () => {
    const response = await handleSendContract(
      request({
        token: staffToken,
        body: { reservationId: "mailer_missing" },
      }),
      env(),
    );

    expect(response.status).toBe(409);
  });

  it("rejects a malformed booking reference before touching Firestore", async () => {
    const response = await handleSendContract(
      request({
        token: staffToken,
        body: { reservationId: "../../users/admin" },
      }),
      env(),
    );

    expect(response.status).toBe(400);
  });

  it("says so plainly when the customer has no email address", async () => {
    const response = await handleSendContract(
      request({
        token: staffToken,
        body: { reservationId: NO_EMAIL },
      }),
      env(),
    );

    expect(response.status).toBe(422);

    expect(
      ((await response.json()) as { error: string }).error,
    ).toContain("no email address");

    expect(await deliveries(NO_EMAIL)).toHaveLength(0);
  });

  it("records a failed delivery when the provider rejects the message", async () => {
    resendStatus = 422;
    resendBody = { message: "Domain is not verified" };

    try {
      const response = await handleSendContract(
        request({
          token: staffToken,
          body: { reservationId: FAILING },
        }),
        env(),
      );

      expect(response.status).toBe(502);

      expect(
        ((await response.json()) as { error: string }).error,
      ).toContain("Domain is not verified");
    } finally {
      resendStatus = 200;
      resendBody = { id: "msg_stub_1" };
    }

    const records = await deliveries(FAILING);

    expect(records).toHaveLength(1);

    expect(records[0]).toMatchObject({
      status: "failed",
      providerMessageId: null,
      failureReason: "Domain is not verified",
    });
  });

  it("answers a preflight and turns away an origin that is not allowed", async () => {
    const preflight = await handleSendContract(
      request({ method: "OPTIONS" }),
      env(),
    );

    expect(preflight.status).toBe(204);

    expect(
      preflight.headers.get("Access-Control-Allow-Origin"),
    ).toBe(ORIGIN);

    const blocked = await handleSendContract(
      request({
        token: staffToken,
        origin: "https://not-ours.example.test",
        body: { reservationId: RESERVATION },
      }),
      env(),
    );

    expect(blocked.status).toBe(403);

    expect(
      blocked.headers.get("Access-Control-Allow-Origin"),
    ).toBeNull();
  });
});
