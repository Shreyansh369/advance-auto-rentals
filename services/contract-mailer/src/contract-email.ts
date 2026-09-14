import {
  AGREEMENT_NOTICES,
  AGREEMENT_TERMS,
  CHARGE_ROWS,
  COMPANY,
  GAS_LEVELS,
  PAYMENT_METHODS,
} from "./agreement";

import type { FirestoreValue } from "./firestore-rest";

/*
 * The emailed agreement is rendered from the approved
 * snapshot alone. Nothing the browser sent reaches this
 * function, so a customer can never be emailed a price or an
 * identity that was not the one an administrator approved.
 *
 * What it renders is the client's own form: the same blocks
 * in the same order as the printed copy, with the fourteen
 * clauses underneath. The renter should be able to hold the
 * email and the paper side by side and read the same thing.
 */
export type Party = {
  fullName: string;
  telephone: string | null;
  address: string | null;
  state: string | null;
  localAddress: string | null;
  dateOfBirth: string | null;
  licenceNumber: string | null;
  licenceExpiresAt: string | null;
};

export type Reading = {
  value: number;
  unit: string;
} | null;

export type ContractSnapshot = {
  reservationId: string;
  rentalId: string | null;
  version: number;
  approvedByNameSnapshot: string;

  customer: Party & {
    email: string | null;
    licenceCountry: string;
  };

  additionalDriver: Party | null;

  vehicle: {
    registration: string;
    make: string;
    model: string;
    year: number | null;
    color: string | null;
    vin: string | null;
  };

  dateOut: string;
  dateIn: string;
  actualTimeIn: string | null;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  odometerOut: Reading;
  odometerIn: Reading;
  gasOut: string | null;
  gasIn: string | null;
  extraHours: number;
  depositCents: number;

  waivers: {
    liabilityWaiver: boolean;
    windscreenWaiver: boolean;
    personalAccidentInsurance: boolean;
  };

  charges: Record<string, number>;
  chargeTotalCents: number;

  payment: {
    method: string | null;
    referenceLast4: string | null;
    cardHolder: string | null;
  };

  specialInstructions: string | null;
  notes: string | null;
  preparedBy: string;
  checkedOutBy: string;
  signedByNameSnapshot: string;
  signatureMethod: "drawn" | "typed";
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

function reading(
  value: FirestoreValue | undefined,
): Reading {
  const fields = record(value);

  const amount = optionalCount(fields.value);

  return amount == null
    ? null
    : {
        value: amount,
        unit: text(fields.unit) || "km",
      };
}

function party(
  fields: Record<string, FirestoreValue>,
): Party {
  return {
    fullName: text(fields.fullName),
    telephone: optionalText(fields.telephone),
    address: optionalText(fields.address),
    state: optionalText(fields.state),
    localAddress: optionalText(
      fields.localAddress,
    ),
    dateOfBirth: optionalText(
      fields.dateOfBirth,
    ),
    licenceNumber: optionalText(
      fields.licenceNumber,
    ),
    licenceExpiresAt: optionalText(
      fields.licenceExpiresAt,
    ),
  };
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

  /*
   * Contracts approved before the agreement moved to
   * checkout have no agreement block. Rendering those from
   * an empty object keeps the rest of the email intact
   * rather than failing on history.
   */
  const agreement = record(fields.agreement);

  const waivers = record(agreement.waivers);
  const chargeInput = record(agreement.charges);

  const charges: Record<string, number> = {};

  for (const row of CHARGE_ROWS) {
    charges[row.key] = count(
      chargeInput[row.key],
    );
  }

  const driver = agreement.additionalDriver;

  return {
    reservationId: text(fields.reservationId),
    rentalId: optionalText(fields.rentalId),
    version: count(fields.version),

    approvedByNameSnapshot: text(
      fields.approvedByNameSnapshot,
    ),

    customer: {
      ...party(customer),

      email: optionalText(customer.email),

      licenceCountry: text(
        customer.licenceCountry,
      ),
    },

    additionalDriver:
      driver &&
      typeof driver === "object" &&
      !Array.isArray(driver)
        ? party(driver)
        : null,

    vehicle: {
      registration: text(vehicle.registration),
      make: text(vehicle.make),
      model: text(vehicle.model),
      year: optionalCount(vehicle.year),
      color: optionalText(vehicle.color),
      vin: optionalText(vehicle.vin),
    },

    /* The booking's own dates stand in for a contract
       approved before the agreement carried its own. */
    dateOut:
      optionalText(agreement.dateOut) ??
      text(fields.pickupAt),

    dateIn:
      optionalText(agreement.dateIn) ??
      text(fields.expectedReturnAt),

    actualTimeIn: optionalText(
      agreement.actualTimeIn,
    ),

    pickupLocation: optionalText(
      fields.pickupLocation,
    ),

    dropoffLocation: optionalText(
      fields.dropoffLocation,
    ),

    odometerOut: reading(agreement.odometerOut),
    odometerIn: reading(agreement.odometerIn),

    gasOut: optionalText(agreement.gasOut),
    gasIn: optionalText(agreement.gasIn),

    extraHours: count(agreement.extraHours),

    depositCents: count(agreement.depositCents),

    waivers: {
      liabilityWaiver:
        waivers.liabilityWaiver === true,
      windscreenWaiver:
        waivers.windscreenWaiver === true,
      personalAccidentInsurance:
        waivers.personalAccidentInsurance ===
        true,
    },

    charges,

    chargeTotalCents: count(
      agreement.chargeTotalCents,
    ),

    payment: {
      method: optionalText(
        agreement.paymentMethod,
      ),
      referenceLast4: optionalText(
        agreement.paymentReferenceLast4,
      ),
      cardHolder: optionalText(
        agreement.paymentHolderName,
      ),
    },

    specialInstructions: optionalText(
      agreement.specialInstructions,
    ),

    notes: optionalText(fields.notes),
    preparedBy: text(fields.preparedBy),

    checkedOutBy: text(agreement.checkedOutBy),

    signedByNameSnapshot: text(
      fields.signedByNameSnapshot,
    ),

    /* Bookings taken before the typed-name option existed
       carry no method, and every one of those was drawn. */
    signatureMethod:
      fields.signatureMethod === "typed"
        ? "typed"
        : "drawn",

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

function gasLabel(
  value: string | null,
): string {
  return (
    GAS_LEVELS.find(
      (level) => level.value === value,
    )?.label ?? "Not recorded"
  );
}

function paymentLabel(
  value: string | null,
): string {
  return (
    PAYMENT_METHODS.find(
      (method) => method.value === value,
    )?.label ?? "Not recorded"
  );
}

function readingLabel(value: Reading): string {
  return value
    ? `${value.value} ${value.unit}`
    : "Not recorded";
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
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

function partyRows(
  person: Party,
  licenceCountry: string | null,
): string[] {
  return [
    row("Name", person.fullName || "Not recorded"),
    row(
      "Address",
      person.address ?? "Not recorded",
    ),
    row("State", person.state ?? "Not recorded"),
    row(
      "Local address",
      person.localAddress ?? "Not recorded",
    ),
    row(
      "Date of birth",
      person.dateOfBirth ?? "Not recorded",
    ),
    row(
      "BVI license no.",
      person.licenceNumber
        ? licenceCountry
          ? `${person.licenceNumber} (${licenceCountry})`
          : person.licenceNumber
        : "Not recorded",
    ),
    row(
      "Expiration date",
      formatDay(person.licenceExpiresAt),
    ),
    row(
      "Telephone",
      person.telephone ?? "Not recorded",
    ),
  ];
}

/*
 * The charges table, printed as the form prints it: a row per
 * charge that carries money, then the total. Rows left at
 * zero are omitted rather than filling the email with dashes.
 */
function chargesTable(
  snapshot: ContractSnapshot,
): string {
  const rows = CHARGE_ROWS.filter(
    (charge) => snapshot.charges[charge.key],
  ).map((charge) =>
    row(
      charge.label,
      formatMoney(
        snapshot.charges[charge.key] ?? 0,
      ),
    ),
  );

  rows.push(
    `<tr><th align="left" style="padding:10px 12px 0 0;border-top:1px solid #dde2ea;font:700 13px/1.5 system-ui,sans-serif;color:#131a24">TOTAL</th><td style="padding:10px 0 0;border-top:1px solid #dde2ea;font:700 13px/1.5 system-ui,sans-serif;color:#131a24">${escapeHtml(
      formatMoney(snapshot.chargeTotalCents),
    )}</td></tr>`,
  );

  return section("Charges", rows);
}

function termsHtml(): string {
  const clauses = AGREEMENT_TERMS.map(
    (clause) =>
      `<li style="margin:0 0 8px">${escapeHtml(
        clause,
      )}</li>`,
  ).join("");

  return `<h2 style="margin:28px 0 6px;font:600 13px/1.4 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#7a8496">Terms &amp; conditions</h2><ol style="margin:0;padding-left:18px;font:400 12px/1.6 system-ui,sans-serif;color:#131a24">${clauses}</ol><p style="margin:16px 0 0;font:600 12px/1.6 system-ui,sans-serif;color:#131a24">${escapeHtml(
    AGREEMENT_NOTICES.acknowledgement,
  )}</p>`;
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
    section(
      "Renter",
      partyRows(
        snapshot.customer,
        snapshot.customer.licenceCountry ||
          null,
      ).concat(
        row(
          "Email",
          snapshot.customer.email ??
            "Not recorded",
        ),
      ),
    ),
  ];

  if (snapshot.additionalDriver) {
    parts.push(
      section(
        "Additional renter",
        partyRows(
          snapshot.additionalDriver,
          null,
        ),
      ),
    );
  }

  parts.push(
    section("Vehicle", [
      row(
        "Registration #",
        snapshot.vehicle.registration,
      ),
      row(
        "Make / type",
        snapshot.vehicle.make || "Not recorded",
      ),
      row(
        "Model",
        snapshot.vehicle.model || "Not recorded",
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
        "Date out",
        formatMoment(snapshot.dateOut),
      ),
      row(
        "Date in",
        formatMoment(snapshot.dateIn),
      ),
      row(
        "Actual time in",
        formatMoment(snapshot.actualTimeIn),
      ),
      row(
        "Extra hours",
        String(snapshot.extraHours),
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
      row(
        "KM out",
        readingLabel(snapshot.odometerOut),
      ),
      row(
        "KM in",
        readingLabel(snapshot.odometerIn),
      ),
      row(
        "Gas out",
        gasLabel(snapshot.gasOut),
      ),
      row("Gas in", gasLabel(snapshot.gasIn)),
    ]),

    section("Waivers and deposit", [
      row(
        "Liability waiver",
        yesNo(
          snapshot.waivers.liabilityWaiver,
        ),
      ),
      row(
        "Windscreen waiver",
        yesNo(
          snapshot.waivers.windscreenWaiver,
        ),
      ),
      row(
        "Personal accident insurance",
        yesNo(
          snapshot.waivers
            .personalAccidentInsurance,
        ),
      ),
      row(
        "Deposit",
        formatMoney(snapshot.depositCents),
      ),
    ]),

    chargesTable(snapshot),

    section("Payment information", [
      row(
        "Method",
        paymentLabel(snapshot.payment.method),
      ),
      row(
        "Card / check last 4",
        snapshot.payment.referenceLast4
          ? `•••• ${snapshot.payment.referenceLast4}`
          : "Not recorded",
      ),
      row(
        "Name on card",
        snapshot.payment.cardHolder ??
          "Not recorded",
      ),
    ]),

    section("Agreement", [
      row(
        snapshot.signatureMethod === "typed"
          ? "Accepted by"
          : "Signed by",
        snapshot.signedByNameSnapshot ||
          snapshot.customer.fullName,
      ),
      row(
        snapshot.signatureMethod === "typed"
          ? "Accepted on"
          : "Signed on",
        formatMoment(
          snapshot.signatureCapturedAt,
        ),
      ),
      row("Prepared by", snapshot.preparedBy),
      row(
        "Checked out by",
        snapshot.checkedOutBy || "Not recorded",
      ),
      row(
        "Approved by",
        snapshot.approvedByNameSnapshot,
      ),
      row(
        "Contract version",
        String(snapshot.version),
      ),
    ]),
  );

  if (snapshot.specialInstructions) {
    parts.push(
      section(
        "Special instruction, additional information",
        [
          row(
            "Note",
            snapshot.specialInstructions,
          ),
        ],
      ),
    );
  }

  if (snapshot.notes) {
    parts.push(
      section("Booking note", [
        row("Note", snapshot.notes),
      ]),
    );
  }

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6fa"><div style="max-width:640px;margin:0 auto;padding:28px 32px;background:#ffffff;border-radius:14px"><p style="margin:0;font:600 11px/1.4 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#7a8496">${escapeHtml(
    COMPANY.name,
  )}</p><h1 style="margin:6px 0 0;font:700 20px/1.3 system-ui,sans-serif;color:#131a24">Rental agreement</h1><p style="margin:4px 0 0;font:400 12px/1.6 system-ui,sans-serif;color:#5b6472"><b>T</b> ${escapeHtml(
    COMPANY.telephone,
  )} &nbsp;|&nbsp; <b>E</b> ${escapeHtml(
    COMPANY.email,
  )}<br>${escapeHtml(
    COMPANY.address,
  )}</p><p style="margin:4px 0 0;font:400 13px/1.5 system-ui,sans-serif;color:#5b6472">Booking reference ${escapeHtml(
    snapshot.reservationId,
  )}</p>${parts.join(
    "",
  )}<p style="margin:22px 0 0;font:600 12px/1.6 system-ui,sans-serif;color:#131a24">${escapeHtml(
    AGREEMENT_NOTICES.property,
  )}</p><p style="margin:10px 0 0;font:400 12px/1.6 system-ui,sans-serif;color:#131a24"><em>${escapeHtml(
    AGREEMENT_NOTICES.ocean,
  )}</em> <strong>${escapeHtml(
    AGREEMENT_NOTICES.keepLeft,
  )}</strong></p>${termsHtml()}<p style="margin:28px 0 0;font:400 12px/1.6 system-ui,sans-serif;color:#7a8496">This agreement was approved by ${escapeHtml(
    snapshot.approvedByNameSnapshot,
  )} and is sent as the record of the rental above. Reply to this message if any detail is wrong.</p></div></body></html>`;
}

export function contractText(
  snapshot: ContractSnapshot,
): string {
  const lines = [
    COMPANY.name.toUpperCase(),
    `T ${COMPANY.telephone} | E ${COMPANY.email}`,
    COMPANY.address,
    "",
    "RENTAL AGREEMENT",
    `Booking reference ${snapshot.reservationId}`,
    "",
    "RENTER",
    `Name: ${snapshot.customer.fullName}`,
    `Address: ${
      snapshot.customer.address ?? "Not recorded"
    }`,
    `Telephone: ${
      snapshot.customer.telephone ??
      "Not recorded"
    }`,
    `BVI license no.: ${
      snapshot.customer.licenceNumber ??
      "Not recorded"
    }`,
    `Expiration date: ${formatDay(
      snapshot.customer.licenceExpiresAt,
    )}`,
  ];

  if (snapshot.additionalDriver) {
    lines.push(
      "",
      "ADDITIONAL RENTER",
      `Name: ${snapshot.additionalDriver.fullName}`,
      `BVI license no.: ${
        snapshot.additionalDriver
          .licenceNumber ?? "Not recorded"
      }`,
    );
  }

  lines.push(
    "",
    "VEHICLE",
    `Registration #: ${snapshot.vehicle.registration}`,
    `Make / model: ${`${snapshot.vehicle.make} ${snapshot.vehicle.model}`.trim()}`,
    "",
    "RENTAL PERIOD",
    `Date out: ${formatMoment(snapshot.dateOut)}`,
    `Date in: ${formatMoment(snapshot.dateIn)}`,
    `Extra hours: ${snapshot.extraHours}`,
    `Pickup location: ${
      snapshot.pickupLocation ?? "Not recorded"
    }`,
    `Drop-off location: ${
      snapshot.dropoffLocation ?? "Not recorded"
    }`,
    `KM out: ${readingLabel(
      snapshot.odometerOut,
    )}`,
    `KM in: ${readingLabel(
      snapshot.odometerIn,
    )}`,
    `Gas out: ${gasLabel(snapshot.gasOut)}`,
    `Gas in: ${gasLabel(snapshot.gasIn)}`,
    "",
    "WAIVERS AND DEPOSIT",
    `Liability waiver: ${yesNo(
      snapshot.waivers.liabilityWaiver,
    )}`,
    `Windscreen waiver: ${yesNo(
      snapshot.waivers.windscreenWaiver,
    )}`,
    `Personal accident insurance: ${yesNo(
      snapshot.waivers
        .personalAccidentInsurance,
    )}`,
    `Deposit: ${formatMoney(
      snapshot.depositCents,
    )}`,
    "",
    "CHARGES",
  );

  for (const charge of CHARGE_ROWS) {
    const cents = snapshot.charges[charge.key];

    if (cents) {
      lines.push(
        `${charge.label}: ${formatMoney(cents)}`,
      );
    }
  }

  lines.push(
    `TOTAL: ${formatMoney(
      snapshot.chargeTotalCents,
    )}`,
    "",
    "PAYMENT INFORMATION",
    `Method: ${paymentLabel(
      snapshot.payment.method,
    )}`,
    `Card / check last 4: ${
      snapshot.payment.referenceLast4
        ? `**** ${snapshot.payment.referenceLast4}`
        : "Not recorded"
    }`,
  );

  if (snapshot.specialInstructions) {
    lines.push(
      "",
      "SPECIAL INSTRUCTION, ADDITIONAL INFORMATION",
      snapshot.specialInstructions,
    );
  }

  lines.push(
    "",
    `${
      snapshot.signatureMethod === "typed"
        ? "Accepted by"
        : "Signed by"
    }: ${
      snapshot.signedByNameSnapshot ||
      snapshot.customer.fullName
    }`,
    `${
      snapshot.signatureMethod === "typed"
        ? "Accepted on"
        : "Signed on"
    }: ${formatMoment(
      snapshot.signatureCapturedAt,
    )}`,
    `Prepared by: ${snapshot.preparedBy}`,
    `Checked out by: ${
      snapshot.checkedOutBy || "Not recorded"
    }`,
    `Approved by: ${snapshot.approvedByNameSnapshot}`,
    `Contract version: ${snapshot.version}`,
    "",
    AGREEMENT_NOTICES.property,
    "",
    `${AGREEMENT_NOTICES.ocean} ${AGREEMENT_NOTICES.keepLeft}`,
    "",
    "TERMS & CONDITIONS",
  );

  AGREEMENT_TERMS.forEach((clause, index) => {
    lines.push(`${index + 1}. ${clause}`, "");
  });

  lines.push(AGREEMENT_NOTICES.acknowledgement);

  return lines.join("\n");
}
