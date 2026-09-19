import { describe, expect, it } from "vitest";

import { readEnv } from "../../services/contract-mailer/src/env";

import { handleStaffNotification } from "../../services/contract-mailer/src/staff-handler";

import {
  encodeFields,
  type FirestoreValue,
} from "../../services/contract-mailer/src/firestore-rest";

/*
 * The staff notification endpoint end to end, with Google's
 * identity toolkit, Firestore and the mail provider all
 * standing in.
 *
 * The question this has to answer is not only "does the mail
 * go out" but "can an account that has been approved by
 * nobody use this to reach anyone it likes" — so most of
 * what follows is about who the message goes to and how
 * often.
 */
const env = readEnv({
  FIREBASE_PROJECT_ID: "advance-auto",
  FIREBASE_API_KEY: "public-web-key",
  RESEND_API_KEY: "secret",
  CONTRACT_FROM_EMAIL:
    "Advance Auto <contracts@advanceauto.test>",
  CONTRACT_REPLY_TO: "office@advanceauto.test",
  STAFF_NOTIFICATION_EMAILS:
    "owner@advanceauto.test, manager@advanceauto.test",
  APP_BASE_URL: "https://desk.example.test/",
  CONTRACT_MAILER_ALLOWED_ORIGINS:
    "https://desk.example.test",
});

type Fields = Record<string, FirestoreValue>;

const PENDING: Fields = {
  fullName: "Kedreana Applicant",
  email: "kedreana@example.test",
  mobile: "+1 284 555 0100",
  age: 29,
  requestedRole: "operations",
  role: null,
  status: "pending",
};

const ADMIN: Fields = {
  fullName: "Dana Admin",
  email: "dana@example.test",
  role: "admin",
  status: "approved",
};

type Stub = {
  caller?: string;
  profiles?: Record<string, Fields | null>;
  receipt?: Fields | null;
  receiptStatus?: number;
  providerStatus?: number;
  providerBody?: Record<string, unknown>;
  body?: Record<string, unknown>;
};

function harness(stub: Stub = {}) {
  const calls: Array<{
    url: string;
    method: string;
    body: Record<string, unknown> | null;
  }> = [];

  const caller = stub.caller ?? "uid_pending";

  const profiles = stub.profiles ?? {
    uid_pending: PENDING,
  };

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

    calls.push({
      url,
      method: init?.method ?? "GET",
      body,
    });

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
            localId: caller,
            email:
              typeof profiles[caller]?.email ===
              "string"
                ? profiles[caller]?.email
                : null,
          },
        ],
      });
    }

    if (url.includes("/staffAccessRequests")) {
      if ((init?.method ?? "GET") === "POST") {
        return stub.receiptStatus
          ? new Response(
              JSON.stringify({
                error: {
                  message: "already exists",
                },
              }),
              { status: stub.receiptStatus },
            )
          : ok({});
      }

      return document(stub.receipt ?? null);
    }

    const profileMatch = /\/users\/([^/?]+)/.exec(
      url,
    );

    if (profileMatch) {
      return document(
        profiles[profileMatch[1]] ?? null,
      );
    }

    if (url.endsWith("/emails")) {
      return new Response(
        JSON.stringify(
          stub.providerBody ?? {
            id: "msg_staff_1",
          },
        ),
        {
          status: stub.providerStatus ?? 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    throw new Error(`unstubbed call: ${url}`);
  }) as typeof fetch;

  const request = new Request(
    "https://mailer.example.test/api/notify-staff",
    {
      method: "POST",

      headers: {
        Authorization: "Bearer id-token",
        "Content-Type": "application/json",
        Origin: "https://desk.example.test",
      },

      body: JSON.stringify(
        stub.body ?? {
          action: "access_requested",
        },
      ),
    },
  );

  return {
    calls,

    sent: () =>
      calls.find((call) =>
        call.url.endsWith("/emails"),
      ),

    receiptWrite: () =>
      calls.find(
        (call) =>
          call.url.includes(
            "/staffAccessRequests",
          ) && call.method === "POST",
      ),

    run: () =>
      handleStaffNotification(request, env, {
        fetchImpl,
        now: () =>
          new Date("2026-09-18T19:28:00.000Z"),
      }),
  };
}

describe("staff access request", () => {
  it("emails the configured administrators with the profile on file", async () => {
    const stage = harness();

    const response = await stage.run();

    expect(response.status).toBe(200);

    await expect(
      response.json(),
    ).resolves.toMatchObject({
      status: "sent",
      providerMessageId: "msg_staff_1",
    });

    const sent = stage.sent();

    expect(sent?.body?.to).toEqual([
      "owner@advanceauto.test",
      "manager@advanceauto.test",
    ]);

    expect(sent?.body?.subject).toBe(
      "Staff access request — Kedreana Applicant",
    );

    const html = String(sent?.body?.html);

    expect(html).toContain(
      "Kedreana Applicant",
    );

    expect(html).toContain(
      "kedreana@example.test",
    );

    expect(html).toContain("Operations");

    /* The administrator can act on it in one click. */
    expect(html).toContain(
      "https://desk.example.test/staff",
    );

    /* Replies reach the applicant, not the no-reply sender. */
    expect(sent?.body?.reply_to).toBe(
      "kedreana@example.test",
    );
  });

  it("records the send so a second attempt does not mail again", async () => {
    const first = harness();

    await first.run();

    expect(
      first.receiptWrite()?.body,
    ).toMatchObject({
      fields: expect.anything(),
    });

    const second = harness({
      receipt: {
        uid: "uid_pending",
        notifiedAt:
          "2026-09-18T19:28:00.000Z",
      },
    });

    const response = await second.run();

    expect(response.status).toBe(200);

    await expect(
      response.json(),
    ).resolves.toMatchObject({
      status: "already_notified",
      notifiedAt: "2026-09-18T19:28:00.000Z",
    });

    expect(second.sent()).toBeUndefined();
  });

  it("refuses an account that is not waiting for approval", async () => {
    const stage = harness({
      caller: "uid_admin",
      profiles: { uid_admin: ADMIN },
    });

    const response = await stage.run();

    expect(response.status).toBe(409);
    expect(stage.sent()).toBeUndefined();
  });

  it("refuses an account with no staff profile", async () => {
    const stage = harness({
      profiles: { uid_pending: null },
    });

    const response = await stage.run();

    expect(response.status).toBe(404);
    expect(stage.sent()).toBeUndefined();
  });

  it("ignores any recipient the request tries to supply", async () => {
    const stage = harness({
      body: {
        action: "access_requested",
        to: "attacker@example.test",
        uid: "uid_admin",
        subject: "Invoice attached",
      },
    });

    await stage.run();

    expect(stage.sent()?.body?.to).toEqual([
      "owner@advanceauto.test",
      "manager@advanceauto.test",
    ]);

    expect(stage.sent()?.body?.subject).toBe(
      "Staff access request — Kedreana Applicant",
    );
  });

  it("writes no receipt when the provider refuses", async () => {
    const stage = harness({
      providerStatus: 422,
      providerBody: {
        message: "Domain is not verified.",
      },
    });

    const response = await stage.run();

    expect(response.status).toBe(502);

    await expect(
      response.json(),
    ).resolves.toMatchObject({
      status: "failed",
      error: "Domain is not verified.",
    });

    /*
     * Nothing was delivered, so nothing may claim it was:
     * the next attempt has to be allowed through.
     */
    expect(
      stage.receiptWrite(),
    ).toBeUndefined();
  });

  it("reports an unconfigured recipient list rather than failing silently", async () => {
    const unset = readEnv({
      FIREBASE_PROJECT_ID: "advance-auto",
      FIREBASE_API_KEY: "public-web-key",
      RESEND_API_KEY: "secret",
      CONTRACT_FROM_EMAIL:
        "Advance Auto <contracts@advanceauto.test>",
    });

    const response =
      await handleStaffNotification(
        new Request(
          "https://mailer.example.test/api/notify-staff",
          {
            method: "POST",

            headers: {
              Authorization: "Bearer id-token",
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              action: "access_requested",
            }),
          },
        ),
        unset,
        {
          fetchImpl: (async () =>
            new Response(
              JSON.stringify({
                users: [
                  { localId: "uid_pending" },
                ],
              }),
              { status: 200 },
            )) as typeof fetch,
        },
      );

    expect(response.status).toBe(503);

    await expect(
      response.json(),
    ).resolves.toMatchObject({
      error: expect.stringContaining(
        "STAFF_NOTIFICATION_EMAILS",
      ),
    });
  });
});

describe("staff decision notice", () => {
  const approved: Fields = {
    ...PENDING,
    role: "operations",
    status: "approved",
  };

  function decision(stub: Stub = {}) {
    return harness({
      caller: "uid_admin",

      body: {
        action: "decision",
        uid: "uid_pending",
      },

      profiles: {
        uid_admin: ADMIN,
        uid_pending: approved,
      },

      ...stub,
    });
  }

  it("emails the reviewed account at the address on its profile", async () => {
    const stage = decision();

    const response = await stage.run();

    expect(response.status).toBe(200);

    await expect(
      response.json(),
    ).resolves.toMatchObject({
      status: "sent",
      recipientEmail: "kedreana@example.test",
    });

    const sent = stage.sent();

    expect(sent?.body?.to).toEqual([
      "kedreana@example.test",
    ]);

    expect(sent?.body?.subject).toContain(
      "approved",
    );

    expect(String(sent?.body?.html)).toContain(
      "Operations",
    );
  });

  it("tells a declined applicant without naming a role", async () => {
    const stage = decision({
      profiles: {
        uid_admin: ADMIN,

        uid_pending: {
          ...PENDING,
          role: null,
          status: "rejected",
        },
      },
    });

    const response = await stage.run();

    expect(response.status).toBe(200);

    expect(
      String(stage.sent()?.body?.text),
    ).toContain("not approved");
  });

  it("refuses a caller who is not an administrator", async () => {
    const stage = decision({
      caller: "uid_ops",

      profiles: {
        uid_ops: {
          fullName: "Sam Operations",
          email: "sam@example.test",
          role: "operations",
          status: "approved",
        },

        uid_pending: approved,
      },
    });

    const response = await stage.run();

    expect(response.status).toBe(403);
    expect(stage.sent()).toBeUndefined();
  });

  it("refuses a caller whose own account is still pending", async () => {
    const stage = decision({
      caller: "uid_pending",

      profiles: {
        uid_pending: PENDING,
      },
    });

    const response = await stage.run();

    expect(response.status).toBe(403);
    expect(stage.sent()).toBeUndefined();
  });

  it("refuses an account that has not been decided yet", async () => {
    const stage = decision({
      profiles: {
        uid_admin: ADMIN,
        uid_pending: PENDING,
      },
    });

    const response = await stage.run();

    expect(response.status).toBe(409);
    expect(stage.sent()).toBeUndefined();
  });
});

describe("staff notification transport", () => {
  it("answers a preflight for an allowed origin", async () => {
    const response =
      await handleStaffNotification(
        new Request(
          "https://mailer.example.test/api/notify-staff",
          {
            method: "OPTIONS",

            headers: {
              Origin: "https://desk.example.test",
            },
          },
        ),
        env,
      );

    expect(response.status).toBe(204);

    expect(
      response.headers.get(
        "Access-Control-Allow-Origin",
      ),
    ).toBe("https://desk.example.test");
  });

  it("turns away an origin that is not allowed", async () => {
    const response =
      await handleStaffNotification(
        new Request(
          "https://mailer.example.test/api/notify-staff",
          {
            method: "POST",

            headers: {
              Origin: "https://elsewhere.test",
              Authorization: "Bearer id-token",
            },

            body: JSON.stringify({
              action: "access_requested",
            }),
          },
        ),
        env,
      );

    expect(response.status).toBe(403);
  });

  it("requires a session", async () => {
    const response =
      await handleStaffNotification(
        new Request(
          "https://mailer.example.test/api/notify-staff",
          {
            method: "POST",

            body: JSON.stringify({
              action: "access_requested",
            }),
          },
        ),
        env,
      );

    expect(response.status).toBe(401);
  });

  it("rejects an unknown action", async () => {
    const stage = harness({
      body: { action: "send_invoice" },
    });

    const response = await stage.run();

    expect(response.status).toBe(400);
    expect(stage.sent()).toBeUndefined();
  });
});
