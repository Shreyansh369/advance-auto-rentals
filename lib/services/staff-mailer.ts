import { getFirebaseClient } from "@/lib/firebase/client";

/*
 * Client half of the staff access notifications.
 *
 * An administrator cannot approve an account they never hear
 * about, and the mail provider's key must never reach a
 * browser, so the send runs on the same serverless
 * deployment as the contract mailer
 * (services/contract-mailer). All that is sent from here is
 * which action to take and the signed-in account's Firebase
 * ID token; the endpoint reads the profile, and decides the
 * recipients, itself.
 */
export type StaffNotificationStatus =
  | "sent"
  | "already_notified"
  | "not_configured";

export function staffMailerEndpoint():
  | string
  | null {
  return (
    process.env
      .NEXT_PUBLIC_STAFF_MAILER_URL ?? ""
  ).trim() || null;
}

export function staffMailerConfigured(): boolean {
  return staffMailerEndpoint() !== null;
}

async function notify(
  body: Record<string, unknown>,
): Promise<StaffNotificationStatus> {
  const endpoint = staffMailerEndpoint();

  if (!endpoint) {
    return "not_configured";
  }

  const user =
    getFirebaseClient().auth.currentUser;

  if (!user) {
    throw new Error(
      "Your session has expired. Please sign in again.",
    );
  }

  const idToken = await user.getIdToken();

  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: "POST",

      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },

      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "The notification service could not be reached. Check your connection and try again.",
    );
  }

  let payload: {
    status?: string;
    error?: string;
  };

  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(
      payload.error ??
        `The notification could not be sent (${response.status}).`,
    );
  }

  return payload.status === "already_notified"
    ? "already_notified"
    : "sent";
}

/**
 * Tell the administrators that this account has registered
 * and is waiting. Sent once per account: a second call is
 * answered with `already_notified` rather than more mail.
 */
export function notifyStaffAccessRequest(): Promise<StaffNotificationStatus> {
  return notify({ action: "access_requested" });
}

/**
 * Tell an applicant what an administrator decided. Only an
 * administrator can call this, and it reaches only the
 * address on the reviewed profile.
 */
export function notifyStaffDecision(
  uid: string,
): Promise<StaffNotificationStatus> {
  return notify({ action: "decision", uid });
}
