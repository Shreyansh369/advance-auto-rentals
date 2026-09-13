import { getFirebaseClient } from "@/lib/firebase/client";

/*
 * Client half of the contract mailer.
 *
 * The application is a static export with no server of its
 * own, and the mail provider's key must never reach a
 * browser, so sending runs on a small serverless endpoint
 * deployed separately (services/contract-mailer). All this
 * sends is the booking reference and the signed-in
 * employee's Firebase ID token; the endpoint reads the
 * contract, the customer and the recipient address from
 * Firestore itself.
 */
export type ContractSendResult = {
  status: "sent";
  deliveryId: string;
  providerMessageId: string;
  recipientEmail: string;
  contractVersion: number;
  sentAt: string;
};

export function contractMailerEndpoint():
  | string
  | null {
  return (
    process.env
      .NEXT_PUBLIC_CONTRACT_MAILER_URL ?? ""
  ).trim() || null;
}

export function contractMailerConfigured(): boolean {
  return contractMailerEndpoint() !== null;
}

export async function sendContractEmail(
  reservationId: string,
): Promise<ContractSendResult> {
  const endpoint = contractMailerEndpoint();

  if (!endpoint) {
    throw new Error(
      "Contract email is not configured. Set NEXT_PUBLIC_CONTRACT_MAILER_URL to the deployed mailer endpoint.",
    );
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

      body: JSON.stringify({ reservationId }),
    });
  } catch {
    throw new Error(
      "The contract mailer could not be reached. Check your connection and try again.",
    );
  }

  let body: {
    error?: string;
    status?: string;
    deliveryId?: string;
    providerMessageId?: string;
    recipientEmail?: string;
    contractVersion?: number;
    sentAt?: string;
  };

  try {
    body = (await response.json()) as typeof body;
  } catch {
    body = {};
  }

  if (!response.ok || body.status !== "sent") {
    throw new Error(
      body.error ??
        `The contract could not be emailed (${response.status}).`,
    );
  }

  return {
    status: "sent",
    deliveryId: String(body.deliveryId ?? ""),

    providerMessageId: String(
      body.providerMessageId ?? "",
    ),

    recipientEmail: String(
      body.recipientEmail ?? "",
    ),

    contractVersion: Number(
      body.contractVersion ?? 0,
    ),

    sentAt: String(body.sentAt ?? ""),
  };
}
