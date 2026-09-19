import {
  ConfigurationError,
  type MailerEnv,
} from "./env";

import {
  createFirestoreClient,
  FirestoreError,
  type FirestoreClient,
  type FirestoreValue,
} from "./firestore-rest";

import {
  AuthenticationError,
  resolveCaller,
} from "./identity";

import { sendEmail } from "./resend";

import {
  accessRequestHtml,
  accessRequestSubject,
  accessRequestText,
  decisionHtml,
  decisionSubject,
  decisionText,
  readStaffProfile,
  StaffProfileError,
  type StaffProfile,
} from "./staff-email";

export type StaffHandlerDeps = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

class RequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function corsHeaders(
  env: MailerEnv,
  origin: string | null,
): Record<string, string> {
  if (
    !origin ||
    !env.allowedOrigins.includes(origin)
  ) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type",
    "Access-Control-Allow-Methods":
      "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function bearerToken(request: Request): string {
  const header =
    request.headers.get("authorization") ?? "";

  const match = /^Bearer\s+(.+)$/i.exec(
    header.trim(),
  );

  if (!match) {
    throw new RequestError(
      401,
      "Sign in again and retry: no session was presented.",
    );
  }

  return match[1].trim();
}

function requireUid(value: unknown): string {
  const uid = String(value ?? "").trim();

  if (
    !uid ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(uid)
  ) {
    throw new RequestError(
      400,
      "A staff account reference is required.",
    );
  }

  return uid;
}

async function loadProfile(
  firestore: FirestoreClient,
  uid: string,
): Promise<StaffProfile> {
  return readStaffProfile(
    uid,
    await firestore.getDocument(`users/${uid}`),
  );
}

/*
 * An applicant announcing themselves.
 *
 * The recipients come from the deployment configuration and
 * the details come from the applicant's own profile
 * document, so the only thing this call decides is *whether*
 * the administrators hear about this account — never who is
 * written to or what is said. That is what keeps an endpoint
 * open to unapproved accounts from being a mail relay.
 */
async function announceAccessRequest(options: {
  env: MailerEnv;
  firestore: FirestoreClient;
  uid: string;
  now: Date;
  fetchImpl?: typeof fetch;
  cors: Record<string, string>;
}): Promise<Response> {
  const { env, firestore, uid } = options;

  if (env.staffNotificationEmails.length === 0) {
    throw new ConfigurationError(
      "STAFF_NOTIFICATION_EMAILS is not set on the staff notifier.",
    );
  }

  const profile = await loadProfile(
    firestore,
    uid,
  );

  if (profile.status !== "pending") {
    throw new RequestError(
      409,
      "This account is not waiting for approval.",
    );
  }

  /*
   * One announcement per account. The receipt is what makes
   * that true, and it is checked before the provider is
   * called so a signed-in applicant cannot turn a retry loop
   * into a stream of mail to the office.
   */
  const existing = await firestore.getDocument(
    `staffAccessRequests/${uid}`,
  );

  if (existing) {
    return json(
      200,
      {
        status: "already_notified",

        notifiedAt:
          typeof existing.notifiedAt === "string"
            ? existing.notifiedAt
            : null,
      },
      options.cors,
    );
  }

  const requestedAt = options.now.toISOString();

  const result = await sendEmail({
    baseUrl: env.resendBaseUrl,
    apiKey: env.resendApiKey,
    from: env.fromEmail,
    to: env.staffNotificationEmails,
    replyTo: profile.email ?? env.replyToEmail,
    subject: accessRequestSubject(profile),

    html: accessRequestHtml({
      profile,
      appBaseUrl: env.appBaseUrl,
      requestedAt,
    }),

    text: accessRequestText({
      profile,
      appBaseUrl: env.appBaseUrl,
      requestedAt,
    }),

    fetchImpl: options.fetchImpl,
  });

  if (!result.ok) {
    /*
     * No receipt is written for a failed send: the applicant
     * is still invisible to the office, so the next attempt
     * has to be allowed to go out.
     */
    return json(
      502,
      {
        status: "failed",
        error: result.reason,
      },
      options.cors,
    );
  }

  const receipt: Record<string, FirestoreValue> = {
    uid,
    fullName: profile.fullName,
    email: profile.email,
    requestedRole: profile.requestedRole,
    notifiedAt: requestedAt,
    createdAt: requestedAt,
    provider: "resend",
    providerMessageId: result.messageId,
    recipientCount:
      env.staffNotificationEmails.length,
  };

  try {
    await firestore.createDocument(
      "staffAccessRequests",
      uid,
      receipt,
    );
  } catch (cause) {
    /*
     * The mail is already gone. A receipt that lost a race
     * with a second tab is not a failure worth reporting to
     * someone who is waiting to be let in.
     */
    if (
      !(cause instanceof FirestoreError) ||
      cause.status !== 409
    ) {
      throw cause;
    }
  }

  return json(
    200,
    {
      status: "sent",
      providerMessageId: result.messageId,
      notifiedAt: requestedAt,
    },
    options.cors,
  );
}

/*
 * An administrator's decision, back to the applicant. The
 * caller has to be an approved administrator and the address
 * is the one on the reviewed profile, so this cannot be used
 * to write to anybody who has not registered.
 */
async function announceDecision(options: {
  env: MailerEnv;
  firestore: FirestoreClient;
  actorUid: string;
  uid: string;
  fetchImpl?: typeof fetch;
  cors: Record<string, string>;
}): Promise<Response> {
  const { env, firestore } = options;

  const actor = await loadProfile(
    firestore,
    options.actorUid,
  );

  if (
    actor.status !== "approved" ||
    actor.role !== "admin"
  ) {
    throw new RequestError(
      403,
      "Only an administrator can send an access decision.",
    );
  }

  const profile = await loadProfile(
    firestore,
    options.uid,
  );

  if (
    profile.status !== "approved" &&
    profile.status !== "rejected"
  ) {
    throw new RequestError(
      409,
      "This account has not been approved or declined yet.",
    );
  }

  if (!profile.email) {
    throw new RequestError(
      422,
      "This account has no email address on file.",
    );
  }

  const result = await sendEmail({
    baseUrl: env.resendBaseUrl,
    apiKey: env.resendApiKey,
    from: env.fromEmail,
    to: profile.email,
    replyTo: env.replyToEmail,
    subject: decisionSubject(profile),

    html: decisionHtml({
      profile,
      appBaseUrl: env.appBaseUrl,
    }),

    text: decisionText({
      profile,
      appBaseUrl: env.appBaseUrl,
    }),

    fetchImpl: options.fetchImpl,
  });

  if (!result.ok) {
    return json(
      502,
      {
        status: "failed",
        error: result.reason,
      },
      options.cors,
    );
  }

  return json(
    200,
    {
      status: "sent",
      providerMessageId: result.messageId,
      recipientEmail: profile.email,
    },
    options.cors,
  );
}

/*
 * Staff access notifications.
 *
 * Approval is what stands between a registered account and
 * the rental data, and an administrator cannot approve what
 * they never hear about. This endpoint is the part of that
 * loop that needs the mail provider's key, which is why it
 * lives here rather than in the browser.
 */
export async function handleStaffNotification(
  request: Request,
  env: MailerEnv,
  deps: StaffHandlerDeps = {},
): Promise<Response> {
  const origin = request.headers.get("origin");
  const cors = corsHeaders(env, origin);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: cors,
    });
  }

  if (request.method !== "POST") {
    return json(
      405,
      {
        error:
          "Use POST to send a staff notification.",
      },
      { ...cors, Allow: "POST, OPTIONS" },
    );
  }

  if (
    env.allowedOrigins.length > 0 &&
    origin &&
    !env.allowedOrigins.includes(origin)
  ) {
    return json(
      403,
      {
        error:
          "This origin is not allowed to send staff notifications.",
      },
      {},
    );
  }

  const now = deps.now ?? (() => new Date());

  try {
    const idToken = bearerToken(request);

    let payload: {
      action?: unknown;
      uid?: unknown;
    };

    try {
      payload = (await request.json()) as typeof payload;
    } catch {
      throw new RequestError(
        400,
        "The request body was not valid JSON.",
      );
    }

    const action = String(
      payload.action ?? "",
    ).trim();

    if (
      action !== "access_requested" &&
      action !== "decision"
    ) {
      throw new RequestError(
        400,
        "Unknown staff notification action.",
      );
    }

    const caller = await resolveCaller({
      baseUrl: env.identityBaseUrl,
      apiKey: env.apiKey,
      idToken,
      fetchImpl: deps.fetchImpl,
    });

    const firestore = createFirestoreClient({
      baseUrl: env.firestoreBaseUrl,
      projectId: env.projectId,
      idToken,
      fetchImpl: deps.fetchImpl,
    });

    if (action === "access_requested") {
      return await announceAccessRequest({
        env,
        firestore,
        uid: caller.uid,
        now: now(),
        fetchImpl: deps.fetchImpl,
        cors,
      });
    }

    return await announceDecision({
      env,
      firestore,
      actorUid: caller.uid,
      uid: requireUid(payload.uid),
      fetchImpl: deps.fetchImpl,
      cors,
    });
  } catch (cause) {
    if (cause instanceof RequestError) {
      return json(
        cause.status,
        { error: cause.message },
        cors,
      );
    }

    if (cause instanceof AuthenticationError) {
      return json(
        401,
        { error: cause.message },
        cors,
      );
    }

    if (cause instanceof StaffProfileError) {
      return json(
        404,
        { error: cause.message },
        cors,
      );
    }

    if (cause instanceof FirestoreError) {
      return json(
        cause.status === 403 ||
          cause.status === 401
          ? 403
          : 502,
        {
          error:
            "The staff profile could not be read from Firestore.",
          detail: cause.message,
        },
        cors,
      );
    }

    if (cause instanceof ConfigurationError) {
      return json(
        503,
        { error: cause.message },
        cors,
      );
    }

    return json(
      500,
      {
        error:
          "The notification could not be sent. Try again.",
      },
      cors,
    );
  }
}
