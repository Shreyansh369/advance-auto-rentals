import { getStorage } from "firebase-admin/storage";
import { HttpsError } from "firebase-functions/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase";
import { audit } from "./audit";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value: unknown): string {
  if (value && typeof value === "object" && "toDate" in value) {
    const toDate = (value as { toDate?: () => Date }).toDate;
    if (typeof toDate === "function") {
      return toDate().toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    }
  }

  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.valueOf()) ? "—" : parsed.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function buildRentalAgreementHtml(input: {
  reservationId: string;
  customerName: string;
  telephone: string;
  email: string | null;
  vehicleRegistration: string;
  pickupAt: unknown;
  expectedReturnAt: unknown;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  quote: { baseRentalCents: number; chargedDays: number };
  signatureDataUrl?: string | null;
}): string {
  const signature = input.signatureDataUrl
    ? `<img src="${escapeHtml(input.signatureDataUrl)}" alt="Customer signature" style="max-width:360px;max-height:140px;display:block;" />`
    : "<span>Signature recorded on booking device.</span>";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Rental Agreement ${escapeHtml(input.reservationId)}</title>
<style>
body{font-family:Arial,sans-serif;color:#111827;line-height:1.5;margin:40px}
h1{margin-bottom:4px}h2{margin-top:28px;font-size:18px}
table{width:100%;border-collapse:collapse}td{padding:8px 0;border-bottom:1px solid #e5e7eb}td:first-child{width:32%;font-weight:700}
.signature{margin-top:36px}.small{color:#6b7280;font-size:12px}
</style>
</head>
<body>
<h1>Advance Auto Rentals</h1>
<div class="small">Rental Agreement / Reservation Confirmation</div>

<h2>Reservation</h2>
<table>
<tr><td>Reservation ID</td><td>${escapeHtml(input.reservationId)}</td></tr>
<tr><td>Customer</td><td>${escapeHtml(input.customerName)}</td></tr>
<tr><td>Telephone</td><td>${escapeHtml(input.telephone)}</td></tr>
<tr><td>Email</td><td>${escapeHtml(input.email ?? "Not provided")}</td></tr>
<tr><td>Vehicle</td><td>${escapeHtml(input.vehicleRegistration)}</td></tr>
<tr><td>Pickup</td><td>${escapeHtml(formatDate(input.pickupAt))}</td></tr>
<tr><td>Expected return</td><td>${escapeHtml(formatDate(input.expectedReturnAt))}</td></tr>
<tr><td>Pickup location</td><td>${escapeHtml(input.pickupLocation ?? "Not specified")}</td></tr>
<tr><td>Drop-off location</td><td>${escapeHtml(input.dropoffLocation ?? "Not specified")}</td></tr>
<tr><td>Rental period</td><td>${input.quote.chargedDays} day(s)</td></tr>
<tr><td>Base rental amount</td><td>${money(input.quote.baseRentalCents)}</td></tr>
</table>

<p class="small">This document records the reservation details captured by Advance Auto Rentals. Additional charges, payments, extensions and return adjustments are recorded separately in the rental record.</p>

<div class="signature">
<h2>Customer signature</h2>
${signature}
</div>
</body>
</html>`;
}

export async function sendReservationContractEmail(input: {
  reservationId: string;
  actorUid: string;
  resendApiKey: string;
  fromEmail: string;
  signatureDataUrl: string | null;
}): Promise<{ emailId: string }> {
  const reservationRef = db.collection("reservations").doc(input.reservationId);
  const reservation = await reservationRef.get();

  if (!reservation.exists) {
    throw new HttpsError("not-found", "Reservation was not found.");
  }

  const data = reservation.data()!;
  const customerId = String(data.customerId ?? "");
  if (!customerId) {
    throw new HttpsError("failed-precondition", "Reservation has no customer.");
  }

  const customer = await db.collection("customers").doc(customerId).get();
  if (!customer.exists) {
    throw new HttpsError("not-found", "Customer was not found.");
  }

  const email = String(customer.get("email") ?? "").trim();
  if (!email) {
    throw new HttpsError("failed-precondition", "Customer does not have an email address.");
  }

  const existingSignaturePath = data.customerSignatureStoragePath ?? null;
  const signaturePath = typeof existingSignaturePath === "string" ? existingSignaturePath : null;

  let resolvedSignatureDataUrl = input.signatureDataUrl;
  if (!resolvedSignatureDataUrl && signaturePath) {
    const [bytes] = await getStorage().bucket().file(signaturePath).download();
    resolvedSignatureDataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
  }

  const html = buildRentalAgreementHtml({
    reservationId: input.reservationId,
    customerName: String(customer.get("fullName") ?? "Customer"),
    telephone: String(customer.get("telephone") ?? ""),
    email,
    vehicleRegistration: String(data.vehicleRegistrationSnapshot ?? ""),
    pickupAt: data.pickupAt,
    expectedReturnAt: data.expectedReturnAt,
    pickupLocation: data.pickupLocation ?? null,
    dropoffLocation: data.dropoffLocation ?? null,
    quote: {
      baseRentalCents: Number(data.quote?.baseRentalCents ?? 0),
      chargedDays: Number(data.quote?.chargedDays ?? 0),
    },
    signatureDataUrl: resolvedSignatureDataUrl,
  });

  const payload = {
    from: input.fromEmail,
    to: [email],
    subject: `Advance Auto Rentals — Reservation ${input.reservationId}`,
    html,
    attachments: [
      {
        filename: `rental-agreement-${input.reservationId}.html`,
        content: Buffer.from(html, "utf8").toString("base64"),
      },
    ],
    tags: [
      { name: "category", value: "rental_agreement" },
      { name: "reservation_id", value: input.reservationId },
    ],
  };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.resendApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const responseData = (await response.json()) as { id?: string; message?: string };

  if (!response.ok || !responseData.id) {
    throw new HttpsError("internal", responseData.message || "The contract email could not be sent.");
  }

  await reservationRef.update({
    contractEmailSentAt: FieldValue.serverTimestamp(),
    contractEmailId: responseData.id,
    contractEmailAddressSnapshot: email,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: input.actorUid,
  });

  await db.runTransaction(async (transaction) => {
    audit(
      transaction,
      input.actorUid,
      "reservation.contract.email.sent",
      { collection: "reservations", id: input.reservationId },
      { emailId: responseData.id },
    );
  });

  return { emailId: responseData.id };
}
