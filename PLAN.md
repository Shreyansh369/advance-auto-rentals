# Admin approvals — implementation plan

Branch: `feature/admin-approvals`. Build order: 3, 4, 1, 5, 2. One commit per task.
Every workflow runs in the browser, so `firestore.rules` is the enforcement; the
screens and `lib/services/firestore-client.ts` only make the right thing easy.

Common pattern for every approval (modelled on `rentalDiscounts`):

- A request document is **created** only with `status: "pending"` and
  `requestedBy == request.auth.uid` (an administrator's own action is applied
  directly instead, as discounts are today).
- It is **decided** only by an administrator, only from `pending`, only once,
  with `reviewedBy == request.auth.uid` and `reviewedBy != requestedBy`, and the
  update may touch nothing but the decision fields (`affectedKeys().hasOnly(...)`),
  so the requested fields can never change. A rejection needs a note.
- The decision and the final state are written in **one transaction**; the rule
  for "approved" checks the final state with `getAfter`, so an approval cannot
  be recorded without its effect and two admins cannot both win (the request is
  re-read inside the transaction and the second one sees it decided).
- Requests are **never deleted** (`allow delete: if false`).
- Request, approval and rejection each write an `auditLogs` entry (who, when,
  what, reason, decision, note).
- One pending request per booking/rental is enforced by a lock field on the
  booking/rental document that the request transaction writes; concurrent
  requests contend on it, and the create rule requires the lock to point at the
  new request (`getAfter`).

## Task 3 — "Credit" and "ATH" payment methods

Files: `lib/agreement.ts` (`PAYMENT_METHODS` + labels), `lib/services/firestore-client.ts`
(agreement `PAYMENT_METHODS`, checkout method mapping, `RENTAL_PAYMENT_METHODS`),
`functions/src/services/schemas.ts` (`z.enum`), `packages/domain/src/types.ts`
(`PaymentMethod`), `components/reservation-composer.tsx` (Payment tab dropdown,
Checkout radios come from `PAYMENT_METHODS`), `components/past-booking-form.tsx`,
`components/agreement-sheet.tsx` (box ticks come from `PAYMENT_METHODS`),
`components/ledger-entry-receipt.tsx` (bill view label).

- New internal values `account_credit` (label "Credit") and `ath` (label "ATH").
  The existing `credit` (= credit card on the agreement) and `card` (= credit card
  on a payment) keep their meaning and labels.
- Rules: there are no payment-method checks in `firestore.rules` today; none added.
- Tests: label/value unit test; contract-message test keeps "Credit card".
- Data risk: none — additive enum values; old payments render through the same
  fallback label.

## Task 4 — Return odometer optional, return fuel required

Files: `reservation-composer.tsx` (Return tab), `firestore-client.ts` (`returnRental`),
`firestore.rules` (`rentals` update), `schemas.ts`, readers (`getRentalAgreement`,
`approvedAgreementSnapshot`, history, finance — already null-safe, verified).

- Blank odometer → `returnOdometerKm/Value/Unit: null` (never 0). Entered → existing
  checks (number, km/mi, not below pickup).
- Fuel select gets an empty "Select fuel level" first option and `required`;
  `assertFuelLevel` already rejects missing/invalid in the data layer.
- Rules (tightening, on the transition into `status: "returned"` only, so existing
  returned rentals are untouched): `returnFuelLevel` must be a valid level;
  `returnOdometerKm` must be null or a number not below `pickupOdometerKm`.
- Agreement: odometer in blank → "km/miles in" blank, total distance blank.
- Tests: rules tests for missing/invalid fuel and odometer below pickup; null odometer accepted.

## Task 1 — Cancellations need admin approval

New collection `cancellationRequests/{id}`: `reservationId, vehicleId,
customerNameSnapshot, vehicleRegistrationSnapshot, pickupAt, expectedReturnAt,
reason, status (pending|approved|rejected|withdrawn), requestedBy,
requestedByNameSnapshot, requestedAt, reviewedBy, reviewedByNameSnapshot,
reviewedAt, reviewNote, withdrawnBy, withdrawnAt, updatedAt`.

New reservation fields (lock + hint): `cancellationRequestId`, `cancellationRequestStatus`;
on approval also `cancellationRequestedBy`, `cancellationRequestedByNameSnapshot`
alongside the existing `cancelledBy`/`cancelledByNameSnapshot` (= approver).

- `cancelReservation`: admin → applies immediately (unchanged); operations → creates the
  request, booking stays confirmed, vehicle stays reserved.
- `reviewCancellationRequest` (admin, transaction): approve = exactly today's
  cancellation + requester/approver recorded; reject = note required, booking stays.
- `checkoutReservation`: a pending request is withdrawn in the same transaction.
- Rules: `reservations` update — only an admin may set `status: "cancelled"` (tightening;
  the existing reason check is kept); a non-admin may only touch the lock fields to open a
  pending request (verified with `getAfter`) or to withdraw it while checking out.
  `cancellationRequests` — pattern above; withdraw allowed to staff only when the booking is
  `checked_out` after the write.
- UI: "Cancel booking" for staff becomes a request; "Cancellation waiting for approval" pill;
  rejected requests show the note to the requester; admin panel with Approve/Reject + note on
  the New booking tab; count beside Bookings (added to the discount count).
- Existing cancellations keep showing in "Cancelled in the last 14 days" (same fields).
- Tests: staff cannot cancel directly, cannot approve, cannot create in another name or
  non-pending, admin decides only pending and once, requested fields immutable, no delete,
  withdraw only on checkout.

## Task 5 — Backdated returns with admin approval

Cause of today's failure (reproduced in the emulator): see the final report — `returnRental`
compares the return time with `rental.pickupAt`, which is the *booked* pickup copied from the
reservation, not when the vehicle actually left. A car collected early cannot be returned at any
time before its booked pickup ("Actual return cannot be before pickup."), and the Return time
input has no min/max to show the allowed range.

New collection `returnRequests/{id}`: `rentalId, reservationId, vehicleId,
customerNameSnapshot, vehicleRegistrationSnapshot, requestedReturnAt, enteredAt, reason,
returnInput {returnFuelLevel, returnOdometer|null, adjustments, waivers, extraHours, notes,
returnMedia, damageMarks}, status, requestedBy…, reviewedBy…, reviewNote, updatedAt`.

New rental fields (lock): `returnRequestId`, `returnRequestStatus`.

- Allowed return time: from the earlier of the booked pickup and the checkout time, up to now.
- More than 15 minutes before entry = backdated; a reason is required (shown only then).
  Operations → request; admin → applied immediately. Return logic is factored into one helper
  so an approval completes the return exactly as a normal one, with the backdated time.
- Rules: on the transition into `returned`, a non-admin's `actualReturnAt` must be within
  15 minutes before `request.time` (and not in the future, 5-minute clock-skew allowance);
  nobody may set it before the pickup/checkout. A non-admin cannot change `actualReturnAt`
  otherwise. Lock fields as for cancellations.
- UI: Return-time min/max; reason field; "Backdated return waiting for approval" on the
  rental (second return blocked); admin list with entered time vs. time entered; Approve
  jumps to Payment when a balance remains; requests shown in the rental file (new
  "Requests" tab) and written to the audit log; count beside Bookings.
- Tests: rules for direct backdated return refused for staff, allowed for admin, request
  lifecycle as for cancellations.

## Task 2 — Daily-rate discounts at the beginning of the contract

Domain (`packages/domain/src/pricing.ts`): `discountedDailyCents(original, {type, value})`,
`withDailyRate(rates, cents)`; unit tests for $, %, rounding, extensions, rent-through,
cheapest mix.

`rentalDiscounts` (existing collection) gains a new kind: `kind: "daily_rate"`,
`reservationId`, `rentalId` (null when asked at booking), `discountType (amount|percent)`,
`discountValue` (cents for amount, percent for percent), `originalDailyCents`,
`discountedDailyCents`, `amountCents` (= reduction per day, keeps the existing rule's
contract), `offeredAt (booking|checkout)`. Old documents (no `kind`) keep working.

Reservation/rental fields: `dailyRateDiscountId`, `dailyRateDiscountStatus` (lock); on
approval `rateSnapshot.dailyCents` becomes the discounted rate and `quote` is re-priced
(weekly/monthly untouched, cheapest mix re-run). The vehicle's own rates never change.

- New booking + Checkout: "$ off the daily rate" input with a switch to "% off the daily rate",
  required reason, live original rate / discount / discounted rate / rental total.
- Admin → applied immediately; operations → pending, charged at full rate until approved.
- Approve before checkout → reservation re-priced; after checkout → rental and reservation
  re-priced, `rentalFinancials` base/total/outstanding lowered, `rental_discount` ledger line,
  agreement charge rows re-priced. A booking-time request carries through checkout.
- Removed: Discount field on the Return tab (admin) and the Payment tab offer form, and the
  flat Checkout discount. Old pending end-of-contract discounts are still listed and decided
  on the Payment tab with the same badge.
- Agreement shows original rate, discount ($ or %), discounted rate, requested/approved by.
- Rules (tightening): new `rentalDiscounts` must be `kind: "daily_rate"` with consistent
  amounts and the lock set on the booking; decisions may only touch decision fields and must
  be by the deciding admin.
- Data risk: old discount documents, ledger lines and adjustments are never rewritten; they
  keep displaying and totalling in Finance, the bill view, history and the agreement.

## Not changed

No migration, no rewrite of existing documents, no new indexes required (all new queries are
single-field or equality-only). Security findings outside tasks 1–5 are reported, not fixed.
