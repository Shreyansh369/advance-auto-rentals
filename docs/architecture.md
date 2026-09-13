# Architecture and data model

## Trust boundary

The web application runs without a server of its own: the project stays on the Firebase Spark plan, so Cloud Functions are not deployed and every workflow executes in the browser against Firestore directly.

Firebase Authentication identifies the caller. Authorisation is resolved from the caller's own `users/{uid}` profile, which must carry `status: "approved"` and a role of `admin` or `operations`; a browser cannot write those fields for itself. Firestore and Storage rules enforce the same check server-side, so they remain the real boundary: reads and writes are denied by default, financial reporting collections are admin-only, and ledger, audit and idempotency records cannot be edited or deleted from a browser.

Because the workflows now run client-side, input validation in `lib/services/firestore-client.ts` is a correctness control rather than a trust boundary. Amounts are validated as whole non-negative cents within a fixed ceiling, odometer readings are converted and range-checked once, enum values are checked against fixed lists, and no `undefined` is ever written. Rate and quote snapshots are still read from the vehicle record inside the transaction rather than accepted from the form, so a tampered browser cannot change what a rental is priced at — but a determined staff account could write a financial document the rules allow it to write. Restoring server-side enforcement requires the Blaze plan and the callable functions kept in `functions/`.

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
| `idempotencyKeys` | Replay protection | Staff read and create only; never updated or deleted |

Rates and quote values use integer USD cents. A rental copies the rate snapshot and quote from its vehicle at reservation time; later rate edits cannot change historic revenue. Ledger and audit entries are append-only from the browser’s perspective.

## Consistency model

- Reservation creation transacts on vehicle/customer, checks overlapping confirmed reservations, snapshots rates, and marks the vehicle reserved.
- Checkout transacts reservation, vehicle and new rental/financial documents. The odometer is converted to kilometres once and the entered value and unit are stored alongside it, so a later return compares like with like.
- Return transacts rental, financial totals, adjustments, and vehicle cleaning status. Re-reading the rental status inside the transaction is what makes a repeated submission safe.
- Payment and expense operations require a UUID idempotency key and write an immutable record plus ledger event atomically. Additional booking fees raise `adjustmentCents` and `totalCents` together so the return, which recomputes the total from `baseRentalCents + adjustmentCents`, cannot count them twice.
- Overdue state is derived from expected-return time by the dashboard query. Without Cloud Functions there is no scheduled job to stamp `status: "overdue"` on a rental document.

## Query/cost controls

The dashboard uses Firestore aggregate counts, bounded compliance reads, and a ten-item reservation query. Fleet listing is capped at 100 results. Composite indexes tracked in `firestore.indexes.json` support the conflict and time-window queries; add an index only with a documented access pattern.
