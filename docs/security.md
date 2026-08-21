# Security model

## Roles

- **Administrator:** all operational and financial reads; trusted-callable access to rates, refunds, and role management.
- **Operations:** operational reads and trusted-callable access to customers, reservations, checkout/return, inspection, payment recording and expense recording. Operations cannot read raw financial records, refunds, ledgers, audit logs, rates-edit endpoint, or role endpoint.

Claims are set only by the `setUserRole` callable using the Admin SDK. A user document does not grant authority.

## Controls and residual responsibilities

| Threat | Implemented control |
| --- | --- |
| Client price/total tampering | Server quotes from vehicle rate; integer cents; server recalculates totals |
| Booking races | Firestore transaction plus overlapping reservation query |
| Duplicate payment/refund/expense submission | UUID idempotency key recorded transactionally |
| Direct database manipulation / IDOR | Deny-by-default rules; roles from Auth claims; client writes denied |
| Financial-history mutation | Browser writes denied; payment, refund and ledger records immutable |
| Malicious uploads | Authenticated role, constrained paths, safe generated IDs, image/PDF MIME and size limits |
| Privilege escalation | Custom claims managed by admin callable, not UI or Firestore profile |
| Data exfiltration | No public Storage paths; financial/audit documents admin-only; pagination caps |
| XSS/injection | React rendering, strict schema validation, no raw HTML rendering |

Enable Firebase App Check in the Firebase console before production and register reCAPTCHA Enterprise for the web app. Callable functions enforce a valid App Check token. In emulator mode App Check is intentionally not initialised.

Store credentials only in Firebase/GCP Secret Manager, GitHub Actions environments, or local untracked `.env.local`. Never add a service-account file, payment secret, or production Firebase project ID to source control. Run `pnpm audit --prod --audit-level=high` and secret scanning in CI before release.
