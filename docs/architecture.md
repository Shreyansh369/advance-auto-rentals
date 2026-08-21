# Architecture and data model

## Trust boundary

The web application is an untrusted client. Firebase Authentication identifies the caller; custom claims (`admin` or `operations`) authorise it. All state-changing business workflows use App Check-enforced callable Cloud Functions. Firestore rules allow staff to read only operational collections and deny all client writes. The Admin SDK used by functions bypasses rules intentionally, so each callable verifies role and validates its full input.

## Collections

| Collection | Purpose | Client access |
| --- | --- | --- |
| `vehicles` | Fleet identity, state, current rates, compliance and photos | Staff read; functions write |
| `customers` | Customer PII and licence metadata | Staff read; functions write |
| `reservations` | Confirmed booking and immutable rate/quote snapshot | Staff read; functions write |
| `rentals` / `inspections` | Operational rental lifecycle and inspections | Staff read; functions write |
| `rentalFinancials`, `payments`, `refunds`, `financialLedger`, `vehicleExpenses` | Financial records | Admin read; functions write only |
| `auditLogs`, `idempotencyKeys`, `imports` | Security, integrity, migration state | No browser access |

Rates and quote values use integer USD cents. A rental copies the rate snapshot and quote from its vehicle at reservation time; later rate edits cannot change historic revenue. Ledger and audit entries are append-only from the browser’s perspective.

## Consistency model

- Reservation creation transacts on vehicle/customer, checks overlapping confirmed reservations, snapshots rates, and marks the vehicle reserved.
- Checkout transacts reservation, vehicle and new rental/financial documents.
- Return transacts rental, financial totals, adjustments, and vehicle cleaning status.
- Payment, refund and expense operations require a UUID idempotency key and write an immutable record plus ledger event atomically.
- A scheduled function transitions overdue active rentals every hour. It is deliberately a safety net; dashboard queries derive overdue state from expected-return time as well.

## Query/cost controls

The dashboard uses Firestore aggregate counts, bounded compliance reads, and a ten-item reservation query. Fleet listing is capped at 100 results. Composite indexes tracked in `firestore.indexes.json` support the conflict and time-window queries; add an index only with a documented access pattern.
