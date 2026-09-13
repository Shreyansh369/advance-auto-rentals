import type { FirestoreValue } from "./firestore-rest";

/*
 * The emailed agreement is rendered from the approved
 * snapshot alone. Nothing the browser sent reaches this
 * function, so a customer can never be emailed a price or an
 * identity that was not the one an administrator approved.
 */
export type ContractSnapshot = {
  reservationId: string;
  version: number;
  approvedByNameSnapshot: string;
  customer: {
    fullName: string;
    telephone: string;
    email: string | null;
    address: string | null;
    licenceNumber: string;
    licenceCountry: string;
    licenceExpiresAt: string | null;
  };
  vehicle: {
    registration: string;
    make: string;
    model: string;
    year: number | null;
    color: string | null;
    vin: string | null;
  };
  pickupAt: string;
  expectedReturnAt: string;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  notes: string | null;
  preparedBy: string;
  chargedDays: number;
  baseRentalCents: number;
  rateSnapshot: {
    dailyCents: number | null;
    weeklyCents: number | null;
    monthlyCents: number | null;
  };
  signedByNameSnapshot: string;
  signatureCapturedAt: string | null;
};

export class SnapshotError extends Error {}

function record(
  value: FirestoreValue | undefined,
): Record<string, FirestoreValue> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value
    : {};
}

function text(
  value: FirestoreValue | undefined,
): string {
  return typeof value === "string" ? value : "";
}

function optionalText(
  value: FirestoreValue | undefined,
): string | null {
  return typeof value === "string" && value.trim()
    ? value
    : null;
}

function count(
  value: FirestoreValue | undefined,
): number {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : 0;
}

function optionalCount(
  value: FirestoreValue | undefined,
): number | null {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : null;
}

export function readSnapshot(
  fields: Record<string, FirestoreValue> | null,
): ContractSnapshot {
  if (!fields) {
    throw new SnapshotError(
      "The approved contract could not be found.",
    );
  }

  const customer = record(fields.customer);
  const vehicle = record(fields.vehicle);
  const rates = record(fields.rateSnapshot);

  return {
    reservationId: text(fields.reservationId),
    version: count(fields.version),

    approvedByNameSnapshot: text(
      fields.approvedByNameSnapshot,
    ),

    customer: {
      fullName: text(customer.fullName),
      telephone: text(customer.telephone),
      email: optionalText(customer.email),
      address: optionalText(customer.address),
      licenceNumber: text(customer.licenceNumber),
      licenceCountry: text(
        customer.licenceCountry,
      ),
      licenceExpiresAt: optionalText(
        customer.licenceExpiresAt,
      ),
    },

    vehicle: {
      registration: text(vehicle.registration),
      make: text(vehicle.make),
      model: text(vehicle.model),
      year: optionalCount(vehicle.year),
      color: optionalText(vehicle.color),
      vin: optionalText(vehicle.vin),
    },

    pickupAt: text(fields.pickupAt),
    expectedReturnAt: text(
      fields.expectedReturnAt,
    ),
    pickupLocation: optionalText(
      fields.pickupLocation,
    ),
    dropoffLocation: optionalText(
      fields.dropoffLocation,
    ),
    notes: optionalText(fields.notes),
    preparedBy: text(fields.preparedBy),
    chargedDays: count(fields.chargedDays),
    baseRentalCents: count(
      fields.baseRentalCents,
    ),

    rateSnapshot: {
      dailyCents: optionalCount(
        rates.dailyCents,
      ),
      weeklyCents: optionalCount(
        rates.weeklyCents,
      ),
      monthlyCents: optionalCount(
        rates.monthlyCents,
      ),
    },

    signedByNameSnapshot: text(
      fields.signedByNameSnapshot,
    ),
    signatureCapturedAt: optionalText(
      fields.signatureCapturedAt,
    ),
  };
}

export function formatMoney(
  cents: number,
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function formatMoment(
  value: string | null,
): string {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

export function formatDay(
  value: string | null,
): string {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

/* The agreement is emailed as HTML, so every value that came
   from a person has to be escaped on the way in. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function row(
  label: string,
  value: string,
): string {
  return `<tr><th align="left" style="padding:6px 12px 6px 0;font:600 12px/1.5 system-ui,sans-serif;color:#5b6472;white-space:nowrap;vertical-align:top">${escapeHtml(
    label,
  )}</th><td style="padding:6px 0;font:400 13px/1.5 system-ui,sans-serif;color:#131a24">${escapeHtml(
    value,
  )}</td></tr>`;
}

function section(
  title: string,
  rows: string[],
): string {
  return `<h2 style="margin:24px 0 6px;font:600 13px/1.4 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#7a8496">${escapeHtml(
    title,
  )}</h2><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${rows.join(
    "",
  )}</table>`;
}

function rate(cents: number | null): string {
  return cents == null
    ? "Not offered"
    : formatMoney(cents);
}

export function contractSubject(
  snapshot: ContractSnapshot,
): string {
  return `Rental agreement ${snapshot.reservationId} — ${snapshot.vehicle.registration}`;
}

export function contractHtml(
  snapshot: ContractSnapshot,
): string {
  const parts = [
    section("Customer", [
      row("Name", snapshot.customer.fullName),
      row(
        "Telephone",
        snapshot.customer.telephone ||
          "Not recorded",
      ),
      row(
        "Email",
        snapshot.customer.email ??
          "Not recorded",
      ),
      row(
        "Address",
        snapshot.customer.address ??
          "Not recorded",
      ),
      row(
        "Licence",
        `${snapshot.customer.licenceNumber} (${snapshot.customer.licenceCountry})`,
      ),
      row(
        "Licence expiry",
        formatDay(
          snapshot.customer.licenceExpiresAt,
        ),
      ),
    ]),

    section("Vehicle", [
      row(
        "Registration",
        snapshot.vehicle.registration,
      ),
      row(
        "Make and model",
        `${snapshot.vehicle.make} ${snapshot.vehicle.model}`.trim() ||
          "Not recorded",
      ),
      row(
        "Year",
        snapshot.vehicle.year == null
          ? "Not recorded"
          : String(snapshot.vehicle.year),
      ),
      row(
        "Colour",
        snapshot.vehicle.color ??
          "Not recorded",
      ),
      row(
        "VIN",
        snapshot.vehicle.vin ?? "Not recorded",
      ),
    ]),

    section("Rental period", [
      row(
        "Pickup",
        formatMoment(snapshot.pickupAt),
      ),
      row(
        "Expected return",
        formatMoment(snapshot.expectedReturnAt),
      ),
      row(
        "Pickup location",
        snapshot.pickupLocation ??
          "Not recorded",
      ),
      row(
        "Drop-off location",
        snapshot.dropoffLocation ??
          "Not recorded",
      ),
    ]),

    section("Charges", [
      row(
        "Rental days",
        String(snapshot.chargedDays),
      ),
      row(
        "Daily rate",
        rate(snapshot.rateSnapshot.dailyCents),
      ),
      row(
        "Weekly rate",
        rate(snapshot.rateSnapshot.weeklyCents),
      ),
      row(
        "Monthly rate",
        rate(
          snapshot.rateSnapshot.monthlyCents,
        ),
      ),
      row(
        "Rental total",
        formatMoney(snapshot.baseRentalCents),
      ),
    ]),

    section("Agreement", [
      row(
        "Signed by",
        snapshot.signedByNameSnapshot ||
          snapshot.customer.fullName,
      ),
      row(
        "Signed on",
        formatMoment(
          snapshot.signatureCapturedAt,
        ),
      ),
      row("Prepared by", snapshot.preparedBy),
      row(
        "Approved by",
        snapshot.approvedByNameSnapshot,
      ),
      row(
        "Contract version",
        String(snapshot.version),
      ),
    ]),
  ];

  if (snapshot.notes) {
    parts.push(
      section("Booking note", [
        row("Note", snapshot.notes),
      ]),
    );
  }

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6fa"><div style="max-width:640px;margin:0 auto;padding:28px 32px;background:#ffffff;border-radius:14px"><p style="margin:0;font:600 11px/1.4 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#7a8496">Advance Auto Rental &amp; Repairs</p><h1 style="margin:6px 0 0;font:700 20px/1.3 system-ui,sans-serif;color:#131a24">Rental agreement</h1><p style="margin:4px 0 0;font:400 13px/1.5 system-ui,sans-serif;color:#5b6472">Booking reference ${escapeHtml(
    snapshot.reservationId,
  )}</p>${parts.join(
    "",
  )}<p style="margin:28px 0 0;font:400 12px/1.6 system-ui,sans-serif;color:#7a8496">This agreement was approved by ${escapeHtml(
    snapshot.approvedByNameSnapshot,
  )} and is sent as the record of the booking above. Reply to this message if any detail is wrong.</p></div></body></html>`;
}

export function contractText(
  snapshot: ContractSnapshot,
): string {
  return [
    "ADVANCE AUTO RENTAL & REPAIRS",
    "Rental agreement",
    `Booking reference ${snapshot.reservationId}`,
    "",
    `Customer: ${snapshot.customer.fullName}`,
    `Telephone: ${
      snapshot.customer.telephone ||
      "Not recorded"
    }`,
    `Licence: ${snapshot.customer.licenceNumber} (${snapshot.customer.licenceCountry})`,
    "",
    `Vehicle: ${snapshot.vehicle.registration} — ${snapshot.vehicle.make} ${snapshot.vehicle.model}`.trim(),
    `Pickup: ${formatMoment(snapshot.pickupAt)}`,
    `Expected return: ${formatMoment(
      snapshot.expectedReturnAt,
    )}`,
    `Pickup location: ${
      snapshot.pickupLocation ?? "Not recorded"
    }`,
    `Drop-off location: ${
      snapshot.dropoffLocation ?? "Not recorded"
    }`,
    "",
    `Rental days: ${snapshot.chargedDays}`,
    `Rental total: ${formatMoney(
      snapshot.baseRentalCents,
    )}`,
    "",
    `Signed by: ${
      snapshot.signedByNameSnapshot ||
      snapshot.customer.fullName
    }`,
    `Signed on: ${formatMoment(
      snapshot.signatureCapturedAt,
    )}`,
    `Prepared by: ${snapshot.preparedBy}`,
    `Approved by: ${snapshot.approvedByNameSnapshot}`,
    `Contract version: ${snapshot.version}`,
  ].join("\n");
}
