# Architecture and data model

## Trust boundary

The web application runs without a server of its own: the project stays on the Firebase Spark plan, so Cloud Functions are not deployed and every workflow executes in the browser against Firestore directly.

Firebase Authentication identifies the caller. Authorisation is resolved from the caller's own `users/{uid}` profile, which must carry `status: "approved"` and a role of `admin` or `operations`; a browser cannot write those fields for itself. Firestore and Storage rules enforce the same check server-side, so they remain the real boundary: reads and writes are denied by default, financial reporting collections are admin-only, and ledger, audit and idempotency records cannot be edited or deleted from a browser.

Because the workflows now run client-side, input validation in `lib/services/firestore-client.ts` is a correctness control rather than a trust boundary. Amounts are validated as whole non-negative cents within a fixed ceiling, odometer readings are converted and range-checked once, enum values are checked against fixed lists, and no `undefined` is ever written. Rate and quote snapshots are still read from the vehicle record inside the transaction rather than accepted from the form, so a tampered browser cannot change what a rental is priced at — but a determined staff account could write a financial document the rules allow it to write. Restoring server-side enforcement requires the Blaze plan and the callable functions kept in `functions/`.

Nothing needs a server. Emailing an approved rental agreement would normally need a mail provider's key, which cannot be handed to a browser — so the agreement is not sent through a provider at all. The employee grants this application the `gmail.send` scope on their own Google account, the browser renders the agreement to a PDF and posts it to the Gmail API as them, and the message leaves the address the renter would reply to. There is no endpoint to deploy, no domain to verify, no key anywhere, and the delivery receipt is written to Firestore under the same rules as everything else.

The `functions/` directory is retained as the reference implementation of these workflows. It is not built, deployed or called by the application.

## Collections

| Collection | Purpose | Client access |
| --- | --- | --- |
| `vehicles` | Fleet identity, state, current rates, compliance and photos | Staff read and write; admin delete |
| `customers` | Customer PII and licence metadata | Staff read and write; admin delete |
| `reservations` | Confirmed booking and immutable rate/quote snapshot | Staff read and write; admin delete |
| `rentals` / `inspections` | Operational rental lifecycle and inspections | Staff read and write; admin delete |
| `rentalFinancials`, `payments` | Rental totals and receipts | Staff read and write; payments are create-only for staff |
| `refunds`, `financialLedger`, `vehicleExpenses` | Profit reporting | Admin read; staff may append ledger and expense entries but never edit or delete them |
| `auditLogs` | Security trail | Admin read; staff append-only |
| `reservationContracts` | Contract review state: status, version and review metadata | Staff read; staff may submit for review; only an admin may approve or reject, and an approved contract is final |
| `reservationContracts/{id}/versions` | The frozen agreement as approved | Staff read; admin create only; never updated or deleted |
| `reservationContracts/{id}/deliveries` | Email delivery receipts | Staff read and create only; never updated or deleted |
| `idempotencyKeys` | Replay protection | Staff read and create only; never updated or deleted |

Rates and quote values use integer USD cents. A rental copies the rate snapshot and quote from its vehicle at reservation time; later rate edits cannot change historic revenue. Ledger and audit entries are append-only from the browser’s perspective.

## Consistency model

- Reservation creation transacts on vehicle/customer, checks overlapping confirmed reservations, snapshots rates, and marks the vehicle reserved.
- Checkout transacts reservation, vehicle and new rental/financial documents. The odometer is converted to kilometres once and the entered value and unit are stored alongside it, so a later return compares like with like.
- Return transacts rental, financial totals, adjustments, and vehicle cleaning status. Re-reading the rental status inside the transaction is what makes a repeated submission safe.
- Payment and expense operations require a UUID idempotency key and write an immutable record plus ledger event atomically. Additional booking fees raise `adjustmentCents` and `totalCents` together so the return, which recomputes the total from `baseRentalCents + adjustmentCents`, cannot count them twice.
- Contract review is a persisted state machine on `reservationContracts/{reservationId}`: an employee submits, which sets `status: "in_review"` and advances `version`; an administrator approves or rejects. Approval copies the customer, vehicle, period and money out of the stored records, inside the same transaction that records the decision, into `versions/v{n}`, which the rules make immutable. Rejection requires a note and sends the contract back for resubmission at the next version. An approved contract is terminal — no rule permits an update that moves it — so the agreement that was emailed can always be reproduced exactly.
- Overdue state is derived from the expected-return time wherever it is displayed: the dashboard count, the dashboard rental list and the active-rentals table all apply the same rule at read time. Without Cloud Functions there is no scheduled job to stamp `status: "overdue"` on a rental document, and a stored flag would be stale rather than wrong-but-harmless, so none is kept.

## Query/cost controls

The dashboard uses Firestore aggregate counts, bounded compliance reads, and a ten-item reservation query. Fleet listing is capped at 100 results. Composite indexes tracked in `firestore.indexes.json` support the conflict and time-window queries; add an index only with a documented access pattern.
