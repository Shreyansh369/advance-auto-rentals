/*
 * Configuration for the contract mailer.
 *
 * Every value here is read from the deployment environment of
 * the serverless function. None of it is bundled into the
 * browser application: the Resend key in particular must only
 * ever exist on this side of the boundary.
 */
export type MailerEnv = {
  /** Firebase project whose Firestore holds the contracts. */
  projectId: string;

  /**
   * The Firebase Web API key. It is public by design and is
   * used here only to have Google verify the caller's ID
   * token through the identity toolkit.
   */
  apiKey: string;

  resendApiKey: string;

  /** RFC 5322 sender, e.g. `Advance Auto <contracts@…>`. */
  fromEmail: string;

  replyToEmail: string | null;

  /** Browser origins allowed to call this endpoint. */
  allowedOrigins: string[];

  /* Overridable so the handler can be tested against the
     Firebase emulators and a stubbed mail provider. */
  firestoreBaseUrl: string;
  identityBaseUrl: string;
  resendBaseUrl: string;
};

export class ConfigurationError extends Error {}

function required(
  source: Record<string, string | undefined>,
  key: string,
): string {
  const value = (source[key] ?? "").trim();

  if (!value) {
    throw new ConfigurationError(
      `${key} is not set on the contract mailer.`,
    );
  }

  return value;
}

function optional(
  source: Record<string, string | undefined>,
  key: string,
  fallback: string,
): string {
  return (source[key] ?? "").trim() || fallback;
}

export function readEnv(
  source: Record<string, string | undefined>,
): MailerEnv {
  return {
    projectId: required(
      source,
      "FIREBASE_PROJECT_ID",
    ),

    apiKey: required(
      source,
      "FIREBASE_API_KEY",
    ),

    resendApiKey: required(
      source,
      "RESEND_API_KEY",
    ),

    fromEmail: required(
      source,
      "CONTRACT_FROM_EMAIL",
    ),

    replyToEmail:
      (source.CONTRACT_REPLY_TO ?? "").trim() ||
      null,

    allowedOrigins: optional(
      source,
      "CONTRACT_MAILER_ALLOWED_ORIGINS",
      "",
    )
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),

    firestoreBaseUrl: optional(
      source,
      "FIRESTORE_BASE_URL",
      "https://firestore.googleapis.com",
    ),

    identityBaseUrl: optional(
      source,
      "IDENTITY_BASE_URL",
      "https://identitytoolkit.googleapis.com",
    ),

    resendBaseUrl: optional(
      source,
      "RESEND_BASE_URL",
      "https://api.resend.com",
    ),
  };
}
