import {
  AGREEMENT_NOTICES,
  CHARGE_ROWS,
  COMPANY,
  GAS_LEVELS,
  PAYMENT_METHODS,
} from "@/lib/agreement";

import { formatMoney } from "@/lib/presentation";

import type { RentalAgreementView } from "@/lib/services/firestore-client";

/*
 * The message the agreement travels in.
 *
 * Sending through a provider would need a domain the business
 * owns and a key kept on a server. Sending as the operator
 * needs neither, costs nothing, and the renter gets it from
 * the address they would reply to anyway.
 *
 * The body is the filled-in form, short enough to read in a
 * mail client without scrolling. The clauses are not repeated
 * here: the whole agreement, terms included, is the PDF
 * attached to the message.
 */
function moment(value: string | null): string {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return "Not recorded";
  }

  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function gasLabel(value: string | null): string {
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

function readingLabel(
  value: { value: number; unit: string } | null,
): string {
  return value
    ? `${value.value} ${value.unit}`
    : "Not recorded";
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

export function agreementSubject(
  agreement: RentalAgreementView,
): string {
  return `Rental agreement ${agreement.rentalId} - ${agreement.vehicle.registration}`;
}

export function agreementBody(
  agreement: RentalAgreementView,
): string {
  const lines = [
    COMPANY.name.toUpperCase(),
    `T ${COMPANY.telephone} | E ${COMPANY.email}`,
    COMPANY.address,
    "",
    "RENTAL AGREEMENT",
    "",
    "RENTER",
    `Name: ${agreement.renter.fullName}`,
    `Address: ${
      agreement.renter.address ?? "Not recorded"
    }`,
    `Telephone: ${
      agreement.renter.telephone ||
      "Not recorded"
    }`,
    `BVI license no.: ${
      agreement.renter.licenceNumber ||
      "Not recorded"
    }`,
    `Expiration date: ${
      agreement.renter.licenceExpiresAt ??
      "Not recorded"
    }`,
  ];

  if (agreement.additionalDriver) {
    lines.push(
      "",
      "ADDITIONAL RENTER",
      `Name: ${agreement.additionalDriver.fullName}`,
      `BVI license no.: ${
        agreement.additionalDriver
          .licenceNumber ?? "Not recorded"
      }`,
    );
  }

  lines.push(
    "",
    "VEHICLE",
    `Registration #: ${agreement.vehicle.registration}`,
    `Make / model: ${`${agreement.vehicle.make} ${agreement.vehicle.model}`.trim()}`,
    "",
    "RENTAL PERIOD",
    `Date out: ${moment(agreement.dateOut)}`,
    `Date in: ${moment(agreement.dateIn)}`,
    `Extra hours: ${agreement.extraHours}`,
    `KM out: ${readingLabel(
      agreement.odometerOut,
    )}`,
    `KM in: ${readingLabel(
      agreement.odometerIn,
    )}`,
    `Gas out: ${gasLabel(agreement.gasOut)}`,
    `Gas in: ${gasLabel(agreement.gasIn)}`,
    "",
    "WAIVERS AND DEPOSIT",
    `Liability waiver: ${yesNo(
      agreement.waivers.liabilityWaiver,
    )}`,
    `Windscreen waiver: ${yesNo(
      agreement.waivers.windscreenWaiver,
    )}`,
    `Personal accident insurance: ${yesNo(
      agreement.waivers
        .personalAccidentInsurance,
    )}`,
    `Deposit: ${formatMoney(
      agreement.depositCents,
    )}`,
    "",
    "CHARGES",
  );

  for (const row of CHARGE_ROWS) {
    const cents = agreement.charges[row.key];

    if (cents) {
      lines.push(
        `${row.label}: ${formatMoney(cents)}`,
      );
    }
  }

  lines.push(
    `TOTAL: ${formatMoney(
      agreement.chargeTotalCents,
    )}`,
    "",
    "PAYMENT INFORMATION",
    `Method: ${paymentLabel(
      agreement.payment.method,
    )}`,
  );

  if (agreement.payment.referenceLast4) {
    lines.push(
      `Card / check last 4: **** ${agreement.payment.referenceLast4}`,
    );
  }

  if (agreement.specialInstructions) {
    lines.push(
      "",
      "SPECIAL INSTRUCTION, ADDITIONAL INFORMATION",
      agreement.specialInstructions,
    );
  }

  lines.push(
    "",
    `${
      agreement.customerSignatureMethod ===
      "typed"
        ? "Accepted by"
        : "Signed by"
    }: ${
      agreement.customerSignatureName ||
      agreement.renter.fullName
    }`,
    `Checked out by: ${agreement.checkedOutBy}`,
    "",
    AGREEMENT_NOTICES.property,
    "",
    `${AGREEMENT_NOTICES.ocean} ${AGREEMENT_NOTICES.keepLeft}`,
    "",
    "The signed copy, with the full terms and conditions, is attached.",
  );

  return lines.join("\n");
}

/*
 * The same message for whatever mail client is installed, for
 * a staff account that does not sign in with Google. The PDF
 * is saved separately and attached by hand on this route.
 */
export function mailtoUrl(
  agreement: RentalAgreementView,
): string {
  const params = new URLSearchParams({
    subject: agreementSubject(agreement),
    body: agreementBody(agreement),
  });

  return `mailto:${encodeURIComponent(
    agreement.renter.email ?? "",
  )}?${params.toString()}`;
}
