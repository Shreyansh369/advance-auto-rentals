import {
  contractHtml,
  contractSubject,
  contractText,
  readSnapshot,
  SnapshotError,
} from "./contract-email";

import {
  ConfigurationError,
  type MailerEnv,
} from "./env";

import {
  createFirestoreClient,
  FirestoreError,
  type FirestoreValue,
} from "./firestore-rest";

import {
  AuthenticationError,
  resolveCaller,
} from "./identity";

import { sendEmail } from "./resend";

export type HandlerDeps = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  newId?: () => string;
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
  if (!origin || !env.allowedOrigins.includes(origin)) {
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
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...headers,
      },
    },
  );
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

function text(
  value: FirestoreValue | undefined,
): string {
  return typeof value === "string" ? value : "";
}

/*
 * The only thing taken from the browser is which booking to
 * send. Everything that ends up in the email — the customer,
 * the vehicle, the money and the recipient address — is read
 * back out of Firestore under the caller's own credentials,
 * so a tampered request cannot change what is sent or where
 * it goes.
 */
export async function handleSendContract(
  request: Request,
  env: MailerEnv,
  deps: HandlerDeps = {},
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
      { error: "Use POST to send a contract." },
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
          "This origin is not allowed to send contracts.",
      },
      {},
    );
  }

  const now = deps.now ?? (() => new Date());

  const newId =
    deps.newId ?? (() => crypto.randomUUID());

  try {
    const idToken = bearerToken(request);

    let payload: { reservationId?: unknown };

    try {
      payload = (await request.json()) as {
        reservationId?: unknown;
      };
    } catch {
      throw new RequestError(
        400,
        "The request body was not valid JSON.",
      );
    }

    const reservationId = String(
      payload.reservationId ?? "",
    ).trim();

    if (
      !reservationId ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(
        reservationId,
      )
    ) {
      throw new RequestError(
        400,
        "A booking reference is required.",
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

    const profile = await firestore.getDocument(
      `users/${caller.uid}`,
    );

    const role = text(profile?.role);

    if (
      !profile ||
      text(profile.status) !== "approved" ||
      (role !== "admin" && role !== "operations")
    ) {
      throw new RequestError(
        403,
        "Your account is not approved to send contracts.",
      );
    }

    const senderName =
      text(profile.fullName).trim() ||
      text(profile.email).trim() ||
      caller.email ||
      caller.uid;

    const contract = await firestore.getDocument(
      `reservationContracts/${reservationId}`,
    );

    if (!contract) {
      throw new RequestError(
        409,
        "This contract has not been submitted for review yet.",
      );
    }

    if (text(contract.status) !== "approved") {
      throw new RequestError(
        409,
        "Only a contract an administrator has approved can be emailed.",
      );
    }

    const version =
      typeof contract.approvedVersion === "number"
        ? contract.approvedVersion
        : 0;

    if (version < 1) {
      throw new RequestError(
        409,
        "This contract has no approved version to send.",
      );
    }

    const snapshot = readSnapshot(
      await firestore.getDocument(
        `reservationContracts/${reservationId}/versions/v${version}`,
      ),
    );

    const recipient = snapshot.customer.email;

    if (!recipient) {
      throw new RequestError(
        422,
        "This customer has no email address on file. Add one and approve the contract again.",
      );
    }

    const deliveryId = newId();
    const sentAt = now().toISOString();

    const result = await sendEmail({
      baseUrl: env.resendBaseUrl,
      apiKey: env.resendApiKey,
      from: env.fromEmail,
      to: recipient,
      replyTo: env.replyToEmail,
      subject: contractSubject(snapshot),
      html: contractHtml(snapshot),
      text: contractText(snapshot),
      fetchImpl: deps.fetchImpl,
    });

    const receipt: Record<string, FirestoreValue> =
      {
        reservationId,
        provider: "resend",
        recipientEmail: recipient,

        recipientNameSnapshot:
          snapshot.customer.fullName,

        contractVersion: version,
        sentBy: caller.uid,
        sentByNameSnapshot: senderName,
        sentAt,
        createdAt: sentAt,

        status: result.ok ? "sent" : "failed",

        providerMessageId: result.ok
          ? result.messageId
          : null,

        failureReason: result.ok
          ? null
          : result.reason.slice(0, 500),
      };

    /*
     * The receipt is written for a failure as well as a
     * success. A contract that could not be delivered is a
     * fact the office needs to see, not one to swallow.
     */
    await firestore.createDocument(
      `reservationContracts/${reservationId}/deliveries`,
      deliveryId,
      receipt,
    );

    if (!result.ok) {
      return json(
        502,
        {
          error: result.reason,
          deliveryId,
          status: "failed",
        },
        cors,
      );
    }

    return json(
      200,
      {
        status: "sent",
        deliveryId,
        providerMessageId: result.messageId,
        recipientEmail: recipient,
        contractVersion: version,
        sentAt,
      },
      cors,
    );
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

    if (cause instanceof SnapshotError) {
      return json(
        409,
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
            "The contract could not be read from Firestore.",
          detail: cause.message,
        },
        cors,
      );
    }

    if (cause instanceof ConfigurationError) {
      return json(
        500,
        { error: cause.message },
        cors,
      );
    }

    return json(
      500,
      {
        error:
          "The contract could not be sent. Try again.",
      },
      cors,
    );
  }
}
