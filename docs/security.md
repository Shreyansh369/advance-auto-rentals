# Security model

## Roles

- **Administrator:** all operational reads and writes plus the financial reporting reads (expenses, ledger, refunds, audit logs) and staff-profile administration.
- **Operations:** the operational workflows — customers, vehicles, reservations, checkout, extension, return, payment and expense recording. Operations cannot read expenses, the ledger, refunds or audit logs, and the Finance screen is closed to them.

A role only takes effect once an administrator sets `role` and `status: "approved"` on the staff member's `users/{uid}` document. Sign-up can only create its own profile with `status: "pending"` and `role: null`, and the rules refuse any self-update that touches `role`, `status` or `requestedRole`, so an account cannot promote itself.

## Controls and residual responsibilities

| Threat | Implemented control |
| --- | --- |
| Client price/total tampering | The quote is computed inside the transaction from the vehicle's own rate document, never from the form; integer cents throughout |
| Booking races | Firestore transaction that re-reads every candidate reservation for the vehicle before writing |
| Duplicate payment/expense submission | UUID idempotency key recorded in the same transaction; the key document cannot be updated or deleted from a browser |
| Duplicate customer records | An edit writes back to the same customer document; a new document is only created when no customer id is supplied |
| Direct database manipulation / IDOR | Deny-by-default rules; role and approval read from `users/{uid}` inside the rules |
| Financial-history mutation | Payments are create-only for staff; ledger, expense and audit entries cannot be edited or deleted except by an administrator |
| Invalid monetary or sensor values | Amounts rejected unless whole non-negative cents within a fixed ceiling; odometer and fuel values validated against fixed ranges and enums; `undefined` is never written |
| Malicious uploads | Image-only MIME allow-list and size ceiling before upload; unsigned Cloudinary preset carries no credential |
| Privilege escalation | Role and approval live in a document the account itself cannot modify |
| Data exfiltration | Financial and audit documents are admin-only; every query is capped |
| XSS/injection | React rendering, no raw HTML rendering |

### Residual risks

The project stays on the Spark plan, so there is no server-side enforcement layer. Two consequences are accepted and should be reviewed before the client scales up:

- An approved staff account can write any document the rules allow it to write, including a rental financial total, without passing through the validation in the application code. Firestore rules restrict who and what, not the arithmetic.
- Customer licence images and vehicle photos are delivered from Cloudinary over unguessable public URLs. The URL is stored only on the customer record, which is staff-only, but anyone holding the URL can open the image. Switching the Cloudinary account's delivery type to authenticated closes this without a code change.
- The upload preset is unsigned and its name is public, so the MIME and size limits in `lib/cloudinary.ts` bind the application, not the endpoint. Anyone who reads the bundle can post directly to Cloudinary and upload outside those limits. Mirror the restrictions on the preset itself in the Cloudinary console — allowed formats, a maximum file size, and a fixed folder — so the limits hold wherever the request comes from. Signed uploads would close it completely but need a server to sign with.
- Nothing deletes a Cloudinary asset. Replacing a licence image or removing a vehicle photo drops the reference from Firestore and leaves the uploaded file in the account. Set a retention rule on the upload folder, or prune by tag (`customer-document`, `vehicle`), until there is a backend that can delete on the customer's behalf.

App Check with reCAPTCHA Enterprise is initialised when `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY` is set and emulators are off. Without callable functions it cannot be enforced on Firestore from the Spark plan, so treat it as defence in depth rather than a gate.

Store credentials only in Firebase/GCP Secret Manager, GitHub Actions environments, or local untracked `.env.local`. Never add a service-account file, payment secret, or production Firebase project ID to source control. Run `pnpm audit --prod --audit-level=high` and secret scanning in CI before release.
