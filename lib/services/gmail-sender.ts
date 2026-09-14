import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
  signInWithPopup,
} from "firebase/auth";

import { getFirebaseClient } from "@/lib/firebase/client";

/*
 * Sends the agreement through the office's own Gmail account.
 *
 * A mail provider would need a domain the business owns and a
 * private key kept on a server. Gmail needs neither: the
 * employee grants this application permission to send as
 * them, once, and the message goes out from the address the
 * renter would reply to anyway. There is no key to deploy and
 * nothing to pay for.
 *
 * The grant is `gmail.send` and nothing else — the narrowest
 * scope Google offers. It cannot read a mailbox, list
 * messages, or see anything already in the account.
 */
const GMAIL_SEND_SCOPE =
  "https://www.googleapis.com/auth/gmail.send";

const GMAIL_SEND_ENDPOINT =
  "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media";

export type GmailSendResult = {
  messageId: string;
  threadId: string | null;
  sentFrom: string | null;
};

export class GmailSendError extends Error {}

/*
 * Google hands the access token back once, on the popup that
 * granted it, and Firebase does not store it. Keeping it for
 * the hour it lives means an operator sending several
 * agreements in a row is asked once rather than every time.
 * It is held in memory only: a reload asks again.
 */
let cachedToken: {
  value: string;
  expiresAt: number;
} | null = null;

export function forgetGmailGrant(): void {
  cachedToken = null;
}

function tokenFromResult(
  credential: ReturnType<
    typeof GoogleAuthProvider.credentialFromResult
  >,
): string {
  const token = credential?.accessToken;

  if (!token) {
    throw new GmailSendError(
      "Google did not grant permission to send. Try again and accept the request.",
    );
  }

  /*
   * Google's tokens last an hour. A minute is taken off so a
   * send that starts just before the edge does not fail
   * halfway through.
   */
  cachedToken = {
    value: token,
    expiresAt: Date.now() + 59 * 60 * 1000,
  };

  return token;
}

async function accessToken(): Promise<string> {
  if (
    cachedToken &&
    cachedToken.expiresAt > Date.now()
  ) {
    return cachedToken.value;
  }

  const { auth } = getFirebaseClient();
  const user = auth.currentUser;

  if (!user) {
    throw new GmailSendError(
      "Your session has expired. Sign in again and retry.",
    );
  }

  const provider = new GoogleAuthProvider();

  provider.addScope(GMAIL_SEND_SCOPE);

  /* Ask which account to send from rather than silently
     picking whichever one the browser last used. */
  provider.setCustomParameters({
    prompt: "consent select_account",
  });

  try {
    /*
     * An account that already signed in with Google is
     * re-authenticated, which keeps the popup on the same
     * account. An account created with a password has no
     * Google identity to re-authenticate, so it signs in
     * through the popup and Firebase links the two.
     */
    const googleLinked = user.providerData.some(
      (entry) =>
        entry.providerId === "google.com",
    );

    const result = googleLinked
      ? await reauthenticateWithPopup(
          user,
          provider,
        )
      : await signInWithPopup(auth, provider);

    return tokenFromResult(
      GoogleAuthProvider.credentialFromResult(
        result,
      ),
    );
  } catch (cause) {
    const code =
      cause &&
      typeof cause === "object" &&
      "code" in cause
        ? String(
            (cause as { code: unknown }).code,
          )
        : "";

    if (
      code === "auth/popup-closed-by-user" ||
      code === "auth/cancelled-popup-request"
    ) {
      throw new GmailSendError(
        "The Google window was closed before permission was given, so nothing was sent.",
      );
    }

    if (code === "auth/popup-blocked") {
      throw new GmailSendError(
        "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
      );
    }

    if (
      code === "auth/user-mismatch" ||
      code ===
        "auth/account-exists-with-different-credential"
    ) {
      throw new GmailSendError(
        "That Google account is not the one signed in here. Choose the account this staff member signs in with.",
      );
    }

    throw new GmailSendError(
      "Google would not grant permission to send. Check that the sign-in is a Google account and try again.",
    );
  }
}

/*
 * RFC 2047 encoded-word, so a renter whose name carries an
 * accent is not mangled in the subject line.
 */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) {
    return value;
  }

  const utf8 = new TextEncoder().encode(value);

  let binary = "";

  for (const byte of utf8) {
    binary += String.fromCharCode(byte);
  }

  return `=?UTF-8?B?${btoa(binary)}?=`;
}

/* A header cannot carry a newline: one would end the header
   block and let the rest be read as body or as more headers. */
function headerValue(value: string): string {
  return encodeHeader(
    value.replace(/[\r\n]+/g, " ").trim(),
  );
}

export function buildMimeMessage(options: {
  to: string;
  subject: string;
  body: string;
  attachment: {
    filename: string;
    base64: string;
    contentType?: string;
  };
}): string {
  const boundary = `aar_${crypto
    .randomUUID()
    .replace(/-/g, "")}`;

  /* Base64 bodies are folded at 76 characters, as the
     transfer encoding requires. */
  const folded =
    options.attachment.base64.match(/.{1,76}/g)?.join(
      "\r\n",
    ) ?? "";

  const filename = options.attachment.filename
    .replace(/[\r\n"]/g, "")
    .slice(0, 120);

  return [
    `To: ${headerValue(options.to)}`,
    `Subject: ${headerValue(options.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Utf8(options.body),
    "",
    `--${boundary}`,
    `Content-Type: ${
      options.attachment.contentType ??
      "application/pdf"
    }; name="${filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${filename}"`,
    "",
    folded,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function base64Utf8(value: string): string {
  const utf8 = new TextEncoder().encode(value);

  let binary = "";

  for (let i = 0; i < utf8.length; i += 0x8000) {
    binary += String.fromCharCode(
      ...utf8.subarray(i, i + 0x8000),
    );
  }

  return (
    btoa(binary).match(/.{1,76}/g)?.join("\r\n") ??
    ""
  );
}

export async function sendAgreementByGmail(options: {
  to: string;
  subject: string;
  body: string;
  attachment: {
    filename: string;
    base64: string;
  };
}): Promise<GmailSendResult> {
  if (!options.to.trim()) {
    throw new GmailSendError(
      "This customer has no email address on file. Add one and try again.",
    );
  }

  const token = await accessToken();

  const mime = buildMimeMessage(options);

  let response: Response;

  try {
    response = await fetch(
      GMAIL_SEND_ENDPOINT,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "message/rfc822",
        },

        body: mime,
      },
    );
  } catch {
    throw new GmailSendError(
      "Gmail could not be reached. Check your connection and try again.",
    );
  }

  if (response.status === 401) {
    /* The grant has lapsed. Drop it so the next attempt asks
       for a fresh one rather than failing the same way. */
    forgetGmailGrant();

    throw new GmailSendError(
      "The permission to send has expired. Try again and accept the Google request.",
    );
  }

  if (!response.ok) {
    let detail = "";

    try {
      const failure = (await response.json()) as {
        error?: { message?: string };
      };

      detail = failure.error?.message ?? "";
    } catch {
      detail = "";
    }

    if (response.status === 403) {
      throw new GmailSendError(
        detail ||
          "This Google account is not allowed to send through the application. Check the Gmail API is enabled on the project.",
      );
    }

    throw new GmailSendError(
      detail ||
        `Gmail refused the message (${response.status}).`,
    );
  }

  const sent = (await response.json()) as {
    id?: string;
    threadId?: string;
  };

  if (!sent.id) {
    throw new GmailSendError(
      "Gmail accepted the request but did not confirm the message. Check the Sent folder before resending.",
    );
  }

  return {
    messageId: sent.id,
    threadId: sent.threadId ?? null,

    sentFrom:
      getFirebaseClient().auth.currentUser
        ?.email ?? null,
  };
}
