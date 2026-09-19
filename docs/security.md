# Security model

## Roles

- **Administrator:** all operational reads and writes plus the financial reporting reads (expenses, ledger, refunds, audit logs) and staff-profile administration.
- **Operations:** the operational workflows — customers, vehicles, reservations, checkout, extension, return, payment and expense recording. Operations cannot read expenses, the ledger, refunds or audit logs, and the Finance screen is closed to them.

A role only takes effect once an administrator sets `role` and `status: "approved"` on the staff member's `users/{uid}` document. Sign-up can only create its own profile with `status: "pending"` and `role: null`, and the rules refuse any self-update that touches `role`, `status` or `requestedRole`, so an account cannot promote itself.

That decision is made on the **Staff** screen, which only an administrator can list `users` to see, and every approval, refusal, suspension and role change is written together with its audit entry in one transaction. An administrator cannot act on their own account there: withdrawing the last administrator's own access would leave the project with nobody able to approve anyone, and it is the one change the screen refuses to make.

A pending account may announce itself to the administrators once, through the staff notification endpoint. The recipients are fixed in that deployment's configuration rather than taken from the request, and the receipt at `staffAccessRequests/{uid}` is create-only, so an account waiting for approval can ask to be noticed but cannot choose who is written to, what is said, or how often.

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
| Contract tampering before delivery | An agreement can only be emailed after an administrator approves it; approval freezes a snapshot in a subcollection the rules make immutable, and the mailer renders from that snapshot alone |
| Forged contract email | The endpoint takes only a booking reference from the browser. The recipient address, the customer identity and every monetary figure are read from Firestore under the caller's own ID token, which Google's identity toolkit verifies first |
| Staff notifier used as a mail relay | The recipients come from `STAFF_NOTIFICATION_EMAILS` on the deployment, never from the request; the announcement is refused unless the caller's own profile is `status: "pending"`, and the create-only receipt at `staffAccessRequests/{uid}` stops a retry loop becoming a stream of mail. A decision notice additionally requires an approved administrator and reaches only the address on the reviewed profile |
| Mail credential exposure | The Resend key lives only in the serverless function's environment. The browser bundle never contains it |
| Customer deletion covering tracks | Deletion is admin-only, is refused while any booking or rental references the customer, and writes an audit entry naming the record removed |
| XSS/injection | React rendering, no raw HTML rendering; the emailed agreement escapes every value that came from a person |

### Residual risks

The project stays on the Spark plan, so there is no general server-side enforcement layer. The consequences below are accepted and should be reviewed before the client scales up:

- An approved staff account can write any document the rules allow it to write, including a rental financial total, without passing through the validation in the application code. Firestore rules restrict who and what, not the arithmetic.
- Customer licence images and vehicle photos are delivered from Cloudinary over unguessable public URLs. The URL is stored only on the customer record, which is staff-only, but anyone holding the URL can open the image. Switching the Cloudinary account's delivery type to authenticated closes this without a code change.
- The upload preset is unsigned and its name is public, so the MIME and size limits in `lib/cloudinary.ts` bind the application, not the endpoint. Anyone who reads the bundle can post directly to Cloudinary and upload outside those limits. Mirror the restrictions on the preset itself in the Cloudinary console — allowed formats, a maximum file size, and a fixed folder — so the limits hold wherever the request comes from. Signed uploads would close it completely but need a server to sign with.
- Nothing deletes a Cloudinary asset. Replacing a licence image, removing a vehicle photo or deleting a customer drops the reference from Firestore and leaves the uploaded file in the account. Deleting a customer records the orphaned `licenceStoragePath` in the audit log so it can be purged from the console. Set a retention rule on the upload folder, or prune by tag (`customer-document`, `vehicle`), until there is a backend that can delete on the customer's behalf.
- The contract mailer acts as the employee who called it rather than as a privileged service, which is what keeps a service-account key out of the deployment. The consequence is that its Firestore writes carry no more authority than the browser's: an approved staff account could write a delivery receipt directly. The receipt is evidence of a send, not a control over it — the send itself cannot be forged, because the Resend key is only in the function's environment.

App Check with reCAPTCHA Enterprise is initialised when `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY` is set and emulators are off. Without callable functions it cannot be enforced on Firestore from the Spark plan, so treat it as defence in depth rather than a gate.

Store credentials only in Firebase/GCP Secret Manager, GitHub Actions environments, or local untracked `.env.local`. Never add a service-account file, payment secret, or production Firebase project ID to source control. Run `pnpm audit --prod --audit-level=high` and secret scanning in CI before release.
