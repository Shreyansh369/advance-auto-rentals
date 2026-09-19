/*
 * The two messages that carry a staff account through
 * approval.
 *
 * Nothing here is taken from the request body. Every value
 * is read back out of `users/{uid}` by the handler, so the
 * mail an administrator receives describes the profile that
 * actually exists rather than whatever a browser claimed.
 */
import { escapeHtml } from "./contract-email";

import type { FirestoreValue } from "./firestore-rest";

export type StaffProfile = {
  uid: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  age: number | null;
  requestedRole: string | null;
  role: string | null;
  status: string;
};

export class StaffProfileError extends Error {}

function text(
  value: FirestoreValue | undefined,
): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

export function readStaffProfile(
  uid: string,
  fields: Record<string, FirestoreValue> | null,
): StaffProfile {
  if (!fields) {
    throw new StaffProfileError(
      "No staff profile exists for this account.",
    );
  }

  const age = fields.age;

  return {
    uid,

    fullName:
      text(fields.fullName) || "Unnamed applicant",

    email: text(fields.email) || null,

    mobile: text(fields.mobile) || null,

    age:
      typeof age === "number" &&
      Number.isFinite(age)
        ? age
        : null,

    requestedRole:
      text(fields.requestedRole) || null,

    role: text(fields.role) || null,

    status:
      text(fields.status).toLowerCase() ||
      "unknown",
  };
}

export function roleLabel(
  value: string | null,
): string {
  if (value === "admin") {
    return "Administrator";
  }

  if (value === "operations") {
    return "Operations";
  }

  return "Not assigned";
}

function rows(
  entries: Array<[string, string]>,
): string {
  return entries
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:6px 14px 6px 0;color:#6b7280;font-size:13px;white-space:nowrap;">
            ${escapeHtml(label)}
          </td>
          <td style="padding:6px 0;color:#111827;font-size:14px;font-weight:600;">
            ${escapeHtml(value)}
          </td>
        </tr>`,
    )
    .join("");
}

function layout(options: {
  heading: string;
  lead: string;
  body: string;
  action: { href: string; label: string } | null;
  footer: string;
}): string {
  const action = options.action
    ? `
      <p style="margin:26px 0 0;">
        <a
          href="${escapeHtml(options.action.href)}"
          style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:700;"
        >${escapeHtml(options.action.label)}</a>
      </p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(options.heading)}</title>
</head>
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:1.4px;color:#6b7280;font-weight:700;">
      ADVANCE AUTO RENTALS
    </p>

    <h1 style="margin:0 0 14px;font-size:22px;color:#111827;">
      ${escapeHtml(options.heading)}
    </h1>

    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;">
      ${escapeHtml(options.lead)}
    </p>

    ${options.body}
    ${action}

    <p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.6;color:#6b7280;">
      ${escapeHtml(options.footer)}
    </p>
  </div>
</body>
</html>`;
}

/* =========================================================
   A NEW STAFF ACCOUNT IS WAITING
   ========================================================= */

export function accessRequestSubject(
  profile: StaffProfile,
): string {
  return `Staff access request — ${profile.fullName}`;
}

export function accessRequestHtml(options: {
  profile: StaffProfile;
  appBaseUrl: string | null;
  requestedAt: string;
}): string {
  const { profile } = options;

  return layout({
    heading: "A staff account is waiting for approval",

    lead: `${profile.fullName} has registered and cannot sign in until an administrator approves the account and assigns a role.`,

    body: `
      <table style="border-collapse:collapse;width:100%;">
        ${rows([
          ["Name", profile.fullName],
          ["Email", profile.email ?? "Not provided"],
          ["Mobile", profile.mobile ?? "Not provided"],
          [
            "Age",
            profile.age === null
              ? "Not provided"
              : String(profile.age),
          ],
          [
            "Requested role",
            roleLabel(profile.requestedRole),
          ],
          [
            "Requested at",
            formatMoment(options.requestedAt),
          ],
        ])}
      </table>`,

    action: options.appBaseUrl
      ? {
          href: `${options.appBaseUrl}/staff`,
          label: "Review the request",
        }
      : null,

    footer:
      "Approve or decline this request on the Staff screen of the rental workspace. Until then the account can sign in but reaches no data.",
  });
}

export function accessRequestText(options: {
  profile: StaffProfile;
  appBaseUrl: string | null;
  requestedAt: string;
}): string {
  const { profile } = options;

  const lines = [
    "A staff account is waiting for approval.",
    "",
    `Name: ${profile.fullName}`,
    `Email: ${profile.email ?? "Not provided"}`,
    `Mobile: ${profile.mobile ?? "Not provided"}`,
    `Age: ${
      profile.age === null
        ? "Not provided"
        : profile.age
    }`,
    `Requested role: ${roleLabel(
      profile.requestedRole,
    )}`,
    `Requested at: ${formatMoment(
      options.requestedAt,
    )}`,
    "",
  ];

  if (options.appBaseUrl) {
    lines.push(
      `Review the request: ${options.appBaseUrl}/staff`,
      "",
    );
  }

  lines.push(
    "Until an administrator approves the account and assigns a role, the applicant can sign in but reaches no data.",
  );

  return lines.join("\n");
}

/* =========================================================
   THE DECISION, BACK TO THE APPLICANT
   ========================================================= */

export function decisionSubject(
  profile: StaffProfile,
): string {
  return profile.status === "approved"
    ? "Your Advance Auto Rentals staff account is approved"
    : "Update on your Advance Auto Rentals staff account";
}

export function decisionHtml(options: {
  profile: StaffProfile;
  appBaseUrl: string | null;
}): string {
  const { profile } = options;

  const approved = profile.status === "approved";

  return layout({
    heading: approved
      ? "Your staff account is approved"
      : "Your staff account was not approved",

    lead: approved
      ? `${profile.fullName}, an administrator has approved your account. You can sign in now.`
      : `${profile.fullName}, an administrator has reviewed your request and it was not approved.`,

    body: approved
      ? `
      <table style="border-collapse:collapse;width:100%;">
        ${rows([["Role", roleLabel(profile.role)]])}
      </table>`
      : "",

    action:
      approved && options.appBaseUrl
        ? {
            href: `${options.appBaseUrl}/login`,
            label: "Sign in",
          }
        : null,

    footer: approved
      ? "If you are already signed in, the workspace opens as soon as you reload the page."
      : "Speak to your administrator if you believe this was a mistake.",
  });
}

export function decisionText(options: {
  profile: StaffProfile;
  appBaseUrl: string | null;
}): string {
  const { profile } = options;

  if (profile.status !== "approved") {
    return [
      `${profile.fullName}, an administrator has reviewed your staff access request and it was not approved.`,
      "",
      "Speak to your administrator if you believe this was a mistake.",
    ].join("\n");
  }

  const lines = [
    `${profile.fullName}, an administrator has approved your staff account. You can sign in now.`,
    "",
    `Role: ${roleLabel(profile.role)}`,
    "",
  ];

  if (options.appBaseUrl) {
    lines.push(
      `Sign in: ${options.appBaseUrl}/login`,
      "",
    );
  }

  lines.push(
    "If you are already signed in, the workspace opens as soon as you reload the page.",
  );

  return lines.join("\n");
}

function formatMoment(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.valueOf())) {
    return "Just now";
  }

  return parsed.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}
