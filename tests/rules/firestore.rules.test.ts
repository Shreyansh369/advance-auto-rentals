import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  deleteDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

/*
 * Roles are resolved from users/{uid} rather than from custom
 * claims: the workspace has no Admin SDK to mint claims with, so
 * a staff profile is what these tests have to seed.
 */
let testEnv: RulesTestEnvironment;

const ADMIN = "admin-user";
const OPS = "ops-user";
const PENDING = "pending-user";

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "advance-auto-rentals-test",
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, "users", ADMIN), {
      email: "admin@example.test",
      role: "admin",
      status: "approved",
      requestedRole: "admin",
    });

    await setDoc(doc(db, "users", OPS), {
      email: "ops@example.test",
      role: "operations",
      status: "approved",
      requestedRole: "operations",
    });

    await setDoc(doc(db, "users", PENDING), {
      email: "pending@example.test",
      role: null,
      status: "pending",
      requestedRole: "operations",
    });

    /* A disposable profile for the deletion test, so removing
       it cannot pull the ground from under the accounts the
       rest of these tests sign in as. */
    await setDoc(doc(db, "users", "removable-user"), {
      email: "removable@example.test",
      fullName: "Removable Account",
      role: "operations",
      status: "approved",
      requestedRole: "operations",
    });

    await setDoc(doc(db, "vehicles", "vehicle_001"), { registrationNumber: "RT-001" });
    await setDoc(doc(db, "customers", "customer_001"), { fullName: "Sample Customer" });
    await setDoc(doc(db, "rentalFinancials", "rental_001"), { totalCents: 10000 });
    await setDoc(doc(db, "vehicleExpenses", "expense_001"), {
      amountCents: 5000,
      recordedBy: ADMIN,
    });

    await setDoc(doc(db, "vehicleExpenses", "expense_ops"), {
      amountCents: 2500,
      recordedBy: OPS,
    });
    await setDoc(doc(db, "financialLedger", "entry_001"), { amountCents: 5000 });
    await setDoc(doc(db, "auditLogs", "audit_001"), { action: "vehicle.created" });
    await setDoc(doc(db, "idempotencyKeys", "payment_001"), { response: { outstandingCents: 0 } });
    await setDoc(doc(db, "vehicleRegistry", "reg_RT-001"), { vehicleId: "vehicle_001", value: "RT-001" });
    await setDoc(doc(db, "rentals", "rental_001", "extensions", "ext_001"), { extensionCents: 1000 });
    await setDoc(doc(db, "rentals", "rental_open"), { status: "active", pickupOdometerKm: 1000 });

    /* Backdated returns: rentals out since three days ago, and
       rentals already waiting on a backdated return. */
    const outSince = Timestamp.fromMillis(Date.now() - 3 * 86_400_000);
    for (const rentalId of ["rental_out", "rental_out_2", "rental_out_3"]) {
      await setDoc(doc(db, "rentals", rentalId), { status: "active", pickupAt: outSince, pickupOdometerKm: 1000 });
    }
    for (const [requestId, rentalId, requestedBy] of [
      ["return_pending", "rental_req", OPS],
      ["return_pending_2", "rental_req_2", OPS],
      ["return_admin_own", "rental_req_admin", ADMIN],
    ]) {
      await setDoc(doc(db, "rentals", rentalId), {
        status: "active",
        pickupAt: outSince,
        pickupOdometerKm: 1000,
        returnRequestId: requestId,
        returnRequestStatus: "pending",
      });
      await setDoc(doc(db, "returnRequests", requestId), {
        rentalId,
        reason: "Car came back last night, desk was closed",
        requestedReturnAt: Timestamp.fromMillis(Date.now() - 12 * 3_600_000),
        returnInput: { returnFuelLevel: "full", returnOdometer: null },
        status: "pending",
        requestedBy,
        reviewedBy: null,
        reviewNote: null,
      });
    }

    /* Cancellation requests: one booking free to ask about, and
       bookings already waiting on a request. */
    await setDoc(doc(db, "reservations", "res_free"), { status: "confirmed", vehicleId: "vehicle_001" });
    for (const [requestId, reservationId, requestedBy] of [
      ["cancel_pending", "res_waiting", OPS],
      ["cancel_pending_2", "res_waiting_2", OPS],
      ["cancel_pending_3", "res_waiting_3", OPS],
      ["cancel_admin_own", "res_waiting_admin", ADMIN],
    ]) {
      await setDoc(doc(db, "reservations", reservationId), {
        status: "confirmed",
        cancellationRequestId: requestId,
        cancellationRequestStatus: "pending",
      });
      await setDoc(doc(db, "cancellationRequests", requestId), {
        reservationId,
        reason: "Customer changed plans",
        status: "pending",
        requestedBy,
        reviewedBy: null,
        reviewNote: null,
      });
    }

    await setDoc(doc(db, "reservationContracts", "contract_review"), {
      status: "in_review",
      version: 1,
    });

    await setDoc(doc(db, "reservationContracts", "contract_rejected"), {
      status: "rejected",
      version: 1,
    });

    await setDoc(doc(db, "reservationContracts", "contract_approved"), {
      status: "approved",
      version: 1,
      approvedVersion: 1,
    });

    await setDoc(
      doc(db, "reservationContracts", "contract_approved", "versions", "v1"),
      { reservationId: "contract_approved", version: 1, baseRentalCents: 16000 },
    );

    await setDoc(
      doc(db, "reservationContracts", "contract_approved", "deliveries", "delivery_001"),
      { status: "sent", providerMessageId: "msg_001", contractVersion: 1 },
    );

    await setDoc(doc(db, "reservationContracts", "contract_admin_review"), {
      status: "in_review",
      version: 1,
    });

    await setDoc(doc(db, "reservationContracts", "contract_ops_review"), {
      status: "in_review",
      version: 1,
    });

    /* Daily-rate discounts: a vehicle with rates, bookings at
       those rates, and discounts already waiting. */
    const rates = { currency: "USD", dailyCents: 7500, weeklyCents: 45000, monthlyCents: 150000 };
    await setDoc(doc(db, "vehicles", "vehicle_rated"), { registrationNumber: "RT-777", rates });
    await setDoc(doc(db, "reservations", "res_rate"), { status: "confirmed", vehicleId: "vehicle_rated", rateSnapshot: rates });
    await setDoc(doc(db, "rentals", "rental_rate"), { status: "active", reservationId: "res_rate_out", rateSnapshot: rates });
    for (const [discountId, reservationId] of [
      ["rate_pending", "res_rate_waiting"],
      ["rate_pending_2", "res_rate_waiting_2"],
    ]) {
      await setDoc(doc(db, "reservations", reservationId), {
        status: "confirmed",
        vehicleId: "vehicle_rated",
        rateSnapshot: rates,
        dailyRateDiscountId: discountId,
        dailyRateDiscountStatus: "pending",
      });
      await setDoc(doc(db, "rentalDiscounts", discountId), {
        kind: "daily_rate",
        reservationId,
        rentalId: null,
        discountType: "amount",
        discountValue: 1000,
        originalDailyCents: 7500,
        discountedDailyCents: 6500,
        amountCents: 1000,
        reason: "Returning customer",
        status: "pending",
        requestedBy: OPS,
        reviewedBy: null,
        reviewNote: null,
      });
    }

    await setDoc(doc(db, "rentalDiscounts", "discount_pending"), {
      rentalId: "rental_001",
      amountCents: 2500,
      status: "pending",
      requestedBy: OPS,
    });

    await setDoc(doc(db, "rentalDiscounts", "discount_decided"), {
      rentalId: "rental_001",
      amountCents: 1000,
      status: "rejected",
      requestedBy: OPS,
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

function asUser(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

describe("Firestore access policy", () => {
  it("denies unauthenticated access to every collection", async () => {
    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(getDoc(doc(db, "vehicles", "vehicle_001")));
    await assertFails(getDoc(doc(db, "customers", "customer_001")));
    await assertFails(setDoc(doc(db, "vehicles", "vehicle_002"), { registrationNumber: "RT-002" }));
  });

  it("denies an account that has not been approved", async () => {
    const db = asUser(PENDING);

    await assertFails(getDoc(doc(db, "vehicles", "vehicle_001")));
    await assertFails(setDoc(doc(db, "customers", "customer_002"), { fullName: "Blocked" }));
  });

  it("lets approved staff run the operational workflows from the browser", async () => {
    const db = asUser(OPS);

    await assertSucceeds(getDoc(doc(db, "vehicles", "vehicle_001")));
    await assertSucceeds(setDoc(doc(db, "vehicles", "vehicle_002"), { registrationNumber: "RT-002" }));
    await assertSucceeds(setDoc(doc(db, "customers", "customer_002"), { fullName: "New Customer" }));
    await assertSucceeds(setDoc(doc(db, "reservations", "reservation_001"), { status: "confirmed", vehicleId: "vehicle_001" }));
    await assertSucceeds(setDoc(doc(db, "rentals", "rental_001"), { status: "active", reservationId: "reservation_001" }));
  });

  it("only closes a rental with a valid return fuel level and a sensible odometer", async () => {
    const db = asUser(OPS);
    const ref = doc(db, "rentals", "rental_open");
    const closing = { status: "returned", actualReturnAt: serverTimestamp() };

    await assertFails(updateDoc(ref, { ...closing, returnOdometerKm: null }));
    await assertFails(updateDoc(ref, { ...closing, returnFuelLevel: "", returnOdometerKm: null }));
    await assertFails(updateDoc(ref, { ...closing, returnFuelLevel: "brimming", returnOdometerKm: null }));
    await assertFails(updateDoc(ref, { ...closing, returnFuelLevel: "full", returnOdometerKm: 900 }));
    await assertFails(updateDoc(ref, { ...closing, returnFuelLevel: "full", returnOdometerKm: "1100" }));
    await assertSucceeds(updateDoc(ref, { ...closing, returnFuelLevel: "half", returnOdometerKm: null, returnOdometerValue: null, returnOdometerUnit: null }));
  });

  it("only cancels a booking that says why", async () => {
    const db = asUser(ADMIN);

    await assertSucceeds(setDoc(doc(db, "reservations", "reservation_cancel"), { status: "confirmed" }));
    await assertFails(
      updateDoc(doc(db, "reservations", "reservation_cancel"), {
        status: "cancelled",
        cancellationReason: null,
      }),
    );
    await assertFails(
      updateDoc(doc(db, "reservations", "reservation_cancel"), {
        status: "cancelled",
        cancellationReason: "   ",
      }),
    );
    await assertSucceeds(
      updateDoc(doc(db, "reservations", "reservation_cancel"), {
        status: "cancelled",
        cancellationReason: "Customer changed their travel dates",
      }),
    );
  });

  it("stops operations staff cancelling a booking directly", async () => {
    await assertSucceeds(setDoc(doc(asUser(OPS), "reservations", "reservation_ops_cancel"), { status: "confirmed", vehicleId: "vehicle_001" }));
    await assertFails(
      updateDoc(doc(asUser(OPS), "reservations", "reservation_ops_cancel"), {
        status: "cancelled",
        cancellationReason: "Customer changed their travel dates",
      }),
    );
  });

  it("stops staff releasing a booking under another status name", async () => {
    const db = asUser(OPS);

    await assertSucceeds(setDoc(doc(db, "reservations", "res_side_door"), { status: "confirmed", vehicleId: "vehicle_001" }));
    for (const status of ["completed", "checked_out", "no_show", "expired"]) {
      await assertFails(updateDoc(doc(db, "reservations", "res_side_door"), { status }));
    }

    /* A real checkout and a real return still move it on. */
    const checkout = writeBatch(db);
    checkout.set(doc(db, "rentals", "rental_side_door"), { status: "active", reservationId: "res_side_door", pickupOdometerKm: 10 });
    checkout.update(doc(db, "reservations", "res_side_door"), { status: "checked_out", rentalId: "rental_side_door" });
    await assertSucceeds(checkout.commit());

    await assertFails(updateDoc(doc(db, "reservations", "res_side_door"), { status: "completed" }));

    const closing = writeBatch(db);
    closing.update(doc(db, "rentals", "rental_side_door"), {
      status: "returned",
      returnFuelLevel: "full",
      returnOdometerKm: null,
      actualReturnAt: serverTimestamp(),
    });
    closing.update(doc(db, "reservations", "res_side_door"), { status: "completed" });
    await assertSucceeds(closing.commit());
  });

  it("lets staff ask for a cancellation only as their own pending request, locked to the booking", async () => {
    const db = asUser(OPS);
    const request = (id: string, data: Record<string, unknown>) => {
      const batch = writeBatch(db);
      batch.set(doc(db, "cancellationRequests", id), data);
      batch.update(doc(db, "reservations", "res_free"), {
        cancellationRequestId: id,
        cancellationRequestStatus: "pending",
      });
      return batch.commit();
    };
    const asked = { reservationId: "res_free", reason: "Flight cancelled", status: "pending", requestedBy: OPS };

    await assertFails(request("cr_other_name", { ...asked, requestedBy: ADMIN }));
    await assertFails(request("cr_self_approved", { ...asked, status: "approved" }));
    await assertFails(request("cr_no_reason", { ...asked, reason: "  " }));
    await assertFails(setDoc(doc(db, "cancellationRequests", "cr_unlocked"), asked));
    await assertSucceeds(request("cr_ok", asked));

    /* Nothing else can be asked while that one waits. */
    await assertFails(request("cr_second", asked));

    /* The booking is still confirmed, and staff cannot fake the decision on it. */
    await assertFails(updateDoc(doc(db, "reservations", "res_free"), { cancellationRequestStatus: "approved" }));
    await assertSucceeds(getDoc(doc(db, "cancellationRequests", "cr_ok")));
  });

  it("keeps the cancellation decision with an administrator, once, and as asked", async () => {
    const admin = asUser(ADMIN);
    const ops = asUser(OPS);
    const decided = { status: "approved", reviewedBy: ADMIN, reviewedAt: serverTimestamp(), reviewNote: null };

    /* Staff cannot approve, even with the booking cancelled alongside. */
    const opsBatch = writeBatch(ops);
    opsBatch.update(doc(ops, "cancellationRequests", "cancel_pending"), { ...decided, reviewedBy: OPS });
    await assertFails(opsBatch.commit());

    /* An approval that does not cancel the booking is refused. */
    await assertFails(updateDoc(doc(admin, "cancellationRequests", "cancel_pending"), decided));

    /* The reason asked for cannot be rewritten while deciding. */
    const rewrite = writeBatch(admin);
    rewrite.update(doc(admin, "reservations", "res_waiting"), { status: "cancelled", cancellationReason: "x" });
    rewrite.update(doc(admin, "cancellationRequests", "cancel_pending"), { ...decided, reason: "Something else" });
    await assertFails(rewrite.commit());

    /* Recorded in somebody else's name. */
    const otherName = writeBatch(admin);
    otherName.update(doc(admin, "reservations", "res_waiting"), { status: "cancelled", cancellationReason: "x" });
    otherName.update(doc(admin, "cancellationRequests", "cancel_pending"), { ...decided, reviewedBy: OPS });
    await assertFails(otherName.commit());

    const approve = writeBatch(admin);
    approve.update(doc(admin, "reservations", "res_waiting"), {
      status: "cancelled",
      cancellationReason: "Customer changed plans",
      cancellationRequestStatus: "approved",
    });
    approve.update(doc(admin, "cancellationRequests", "cancel_pending"), decided);
    await assertSucceeds(approve.commit());

    /* Only once. */
    await assertFails(
      updateDoc(doc(admin, "cancellationRequests", "cancel_pending"), {
        status: "rejected",
        reviewedBy: ADMIN,
        reviewNote: "Changed my mind",
      }),
    );

    /* A rejection needs a note. */
    await assertFails(
      updateDoc(doc(admin, "cancellationRequests", "cancel_pending_2"), {
        status: "rejected",
        reviewedBy: ADMIN,
        reviewNote: " ",
      }),
    );
    await assertSucceeds(
      updateDoc(doc(admin, "cancellationRequests", "cancel_pending_2"), {
        status: "rejected",
        reviewedBy: ADMIN,
        reviewNote: "The customer confirmed the booking by phone",
      }),
    );

    /* Never one's own request. */
    await assertFails(
      updateDoc(doc(admin, "cancellationRequests", "cancel_admin_own"), {
        status: "rejected",
        reviewedBy: ADMIN,
        reviewNote: "Mine",
      }),
    );

    /* Never deleted. */
    await assertFails(deleteDoc(doc(admin, "cancellationRequests", "cancel_pending")));
    await assertFails(deleteDoc(doc(ops, "cancellationRequests", "cancel_pending_3")));
  });

  it("withdraws a waiting cancellation only by checking the booking out", async () => {
    const db = asUser(OPS);

    await assertFails(
      updateDoc(doc(db, "cancellationRequests", "cancel_pending_3"), {
        status: "withdrawn",
        withdrawnBy: OPS,
      }),
    );

    /* Marking the booking checked out without a rental is not a checkout. */
    const fake = writeBatch(db);
    fake.update(doc(db, "reservations", "res_waiting_3"), {
      status: "checked_out",
      rentalId: "rental_missing",
      cancellationRequestStatus: "withdrawn",
    });
    fake.update(doc(db, "cancellationRequests", "cancel_pending_3"), { status: "withdrawn", withdrawnBy: OPS });
    await assertFails(fake.commit());

    const checkout = writeBatch(db);
    checkout.set(doc(db, "rentals", "rental_x"), { status: "active", reservationId: "res_waiting_3" });
    checkout.update(doc(db, "reservations", "res_waiting_3"), {
      status: "checked_out",
      rentalId: "rental_x",
      cancellationRequestStatus: "withdrawn",
    });
    checkout.update(doc(db, "cancellationRequests", "cancel_pending_3"), {
      status: "withdrawn",
      withdrawnBy: OPS,
      withdrawnAt: serverTimestamp(),
    });
    await assertSucceeds(checkout.commit());
  });

  it("lets only an administrator record a backdated return directly", async () => {
    const hoursAgo = (hours: number) => Timestamp.fromMillis(Date.now() - hours * 3_600_000);
    const closing = { status: "returned", returnFuelLevel: "full", returnOdometerKm: null };
    const ops = asUser(OPS);
    const admin = asUser(ADMIN);

    await assertFails(updateDoc(doc(ops, "rentals", "rental_out"), { ...closing, actualReturnAt: hoursAgo(2) }));
    await assertFails(updateDoc(doc(ops, "rentals", "rental_out"), { ...closing, actualReturnAt: hoursAgo(-1) }));
    await assertSucceeds(updateDoc(doc(ops, "rentals", "rental_out"), { ...closing, actualReturnAt: hoursAgo(0.1) }));

    /* Not moved back afterwards, either. */
    await assertFails(updateDoc(doc(ops, "rentals", "rental_out"), { actualReturnAt: hoursAgo(5) }));

    /* Never before the vehicle went out, never in the future, even for an administrator. */
    await assertFails(updateDoc(doc(admin, "rentals", "rental_out_2"), { ...closing, actualReturnAt: hoursAgo(24 * 4) }));
    await assertFails(updateDoc(doc(admin, "rentals", "rental_out_2"), { ...closing, actualReturnAt: hoursAgo(-1) }));
    await assertSucceeds(updateDoc(doc(admin, "rentals", "rental_out_2"), { ...closing, actualReturnAt: hoursAgo(5) }));
  });

  it("lets staff ask for a backdated return only as their own pending request, locked to the rental", async () => {
    const db = asUser(OPS);
    const asked = {
      rentalId: "rental_out_3",
      reason: "Returned overnight",
      requestedReturnAt: Timestamp.fromMillis(Date.now() - 10 * 3_600_000),
      returnInput: { returnFuelLevel: "half", returnOdometer: null },
      status: "pending",
      requestedBy: OPS,
    };
    const request = (id: string, data: Record<string, unknown>) => {
      const batch = writeBatch(db);
      batch.set(doc(db, "returnRequests", id), data);
      batch.update(doc(db, "rentals", "rental_out_3"), { returnRequestId: id, returnRequestStatus: "pending" });
      return batch.commit();
    };

    await assertFails(request("rr_other_name", { ...asked, requestedBy: ADMIN }));
    await assertFails(request("rr_approved", { ...asked, status: "approved" }));
    await assertFails(request("rr_no_reason", { ...asked, reason: "" }));
    await assertFails(setDoc(doc(db, "returnRequests", "rr_unlocked"), asked));
    await assertSucceeds(request("rr_ok", asked));
    await assertFails(request("rr_second", asked));

    /* While it waits, no second return can be written. */
    await assertFails(
      updateDoc(doc(db, "rentals", "rental_out_3"), {
        status: "returned",
        returnFuelLevel: "full",
        returnOdometerKm: null,
        actualReturnAt: serverTimestamp(),
      }),
    );
  });

  it("keeps the backdated-return decision with an administrator, once, and as asked", async () => {
    const admin = asUser(ADMIN);
    const ops = asUser(OPS);
    let requested = Timestamp.now();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      requested = (await getDoc(doc(context.firestore(), "returnRequests", "return_pending"))).get("requestedReturnAt");
    });
    const decided = { status: "approved", reviewedBy: ADMIN, reviewNote: null };
    const close = (at: Timestamp) => ({ status: "returned", returnFuelLevel: "full", returnOdometerKm: null, actualReturnAt: at, returnRequestStatus: "approved" });

    const opsBatch = writeBatch(ops);
    opsBatch.update(doc(ops, "returnRequests", "return_pending"), { ...decided, reviewedBy: OPS });
    await assertFails(opsBatch.commit());

    /* Approving without closing the rental, or closing it at another time, is refused. */
    await assertFails(updateDoc(doc(admin, "returnRequests", "return_pending"), decided));
    const wrongTime = writeBatch(admin);
    wrongTime.update(doc(admin, "rentals", "rental_req"), close(Timestamp.fromMillis(requested.toMillis() + 3_600_000)));
    wrongTime.update(doc(admin, "returnRequests", "return_pending"), decided);
    await assertFails(wrongTime.commit());

    /* Nothing asked for changes while deciding. */
    const rewrite = writeBatch(admin);
    rewrite.update(doc(admin, "rentals", "rental_req"), close(requested));
    rewrite.update(doc(admin, "returnRequests", "return_pending"), { ...decided, reason: "edited" });
    await assertFails(rewrite.commit());

    const approve = writeBatch(admin);
    approve.update(doc(admin, "rentals", "rental_req"), close(requested));
    approve.update(doc(admin, "returnRequests", "return_pending"), decided);
    await assertSucceeds(approve.commit());

    await assertFails(
      updateDoc(doc(admin, "returnRequests", "return_pending"), { status: "rejected", reviewedBy: ADMIN, reviewNote: "No" }),
    );

    await assertFails(
      updateDoc(doc(admin, "returnRequests", "return_pending_2"), { status: "rejected", reviewedBy: ADMIN, reviewNote: "" }),
    );
    await assertSucceeds(
      updateDoc(doc(admin, "returnRequests", "return_pending_2"), {
        status: "rejected",
        reviewedBy: ADMIN,
        reviewNote: "The car was seen on the road that evening",
      }),
    );

    await assertFails(
      updateDoc(doc(admin, "returnRequests", "return_admin_own"), { status: "rejected", reviewedBy: ADMIN, reviewNote: "Mine" }),
    );

    await assertFails(deleteDoc(doc(admin, "returnRequests", "return_pending")));
    await assertFails(deleteDoc(doc(ops, "returnRequests", "return_pending_2")));
  });

  it("keeps profit reporting away from operations staff", async () => {
    const db = asUser(OPS);

    await assertFails(getDoc(doc(db, "vehicleExpenses", "expense_001")));
    await assertFails(getDoc(doc(db, "financialLedger", "entry_001")));
    await assertFails(getDoc(doc(db, "auditLogs", "audit_001")));
    await assertFails(getDoc(doc(db, "refunds", "refund_001")));
  });

  /*
   * Recording what the fleet costs to run is operational
   * work, so an operations account may add an expense and
   * read back its own. Everybody else's entries — and so the
   * cost side of the business — stay with an administrator,
   * which is why the unfiltered listing is refused and the
   * filtered one is not.
   */
  it("lets operations record an expense and read back only its own", async () => {
    const db = asUser(OPS);

    await assertSucceeds(
      setDoc(doc(db, "vehicleExpenses", "expense_ops_2"), {
        amountCents: 1500,
        recordedBy: OPS,
      }),
    );

    await assertSucceeds(
      getDoc(doc(db, "vehicleExpenses", "expense_ops")),
    );

    await assertFails(
      getDoc(doc(db, "vehicleExpenses", "expense_001")),
    );

    await assertSucceeds(
      getDocs(
        query(
          collection(db, "vehicleExpenses"),
          where("recordedBy", "==", OPS),
          limit(50),
        ),
      ),
    );

    await assertFails(
      getDocs(
        query(collection(db, "vehicleExpenses"), limit(50)),
      ),
    );
  });

  it("stops an expense being attributed to somebody else", async () => {
    const db = asUser(OPS);

    await assertFails(
      setDoc(doc(db, "vehicleExpenses", "expense_forged"), {
        amountCents: 1500,
        recordedBy: ADMIN,
      }),
    );
  });

  it("keeps an expense unrewritable once it is recorded", async () => {
    const db = asUser(OPS);

    await assertFails(
      updateDoc(doc(db, "vehicleExpenses", "expense_ops"), {
        amountCents: 1,
      }),
    );

    await assertFails(
      deleteDoc(doc(db, "vehicleExpenses", "expense_ops")),
    );
  });

  /*
   * Correcting a staff member's name is an administrator's
   * write to somebody else's profile, which no operations
   * account may make. An account may still fix its own
   * registration details, and neither may reach for a role.
   */
  it("lets only an administrator edit another staff profile", async () => {
    await assertSucceeds(
      updateDoc(doc(asUser(ADMIN), "users", OPS), {
        fullName: "Corrected Name",
        mobile: "1284000000",
        age: 31,
      }),
    );

    await assertFails(
      updateDoc(doc(asUser(OPS), "users", PENDING), {
        fullName: "Not mine to change",
      }),
    );
  });

  /*
   * Removing the profile is what removes the access: the
   * rules read role and status from it. It is therefore an
   * administrator's decision and nobody else's.
   */
  it("lets only an administrator remove a staff profile", async () => {
    await assertFails(
      deleteDoc(
        doc(asUser(OPS), "users", "removable-user"),
      ),
    );

    await assertSucceeds(
      deleteDoc(
        doc(asUser(ADMIN), "users", "removable-user"),
      ),
    );
  });

  it("stops an account granting itself a role while editing its own details", async () => {
    const db = asUser(OPS);

    await assertSucceeds(
      updateDoc(doc(db, "users", OPS), {
        fullName: "Own Name",
        mobile: "1284111111",
      }),
    );

    await assertFails(
      updateDoc(doc(db, "users", OPS), {
        role: "admin",
      }),
    );
  });

  /*
   * A past booking is written as a closed rental with its
   * financial record and an append-only ledger entry, so
   * every document it touches has to be writable by the
   * account entering it.
   */
  it("lets staff enter a historical rental record", async () => {
    const db = asUser(OPS);

    await assertSucceeds(
      setDoc(doc(db, "rentals", "rental_history_001"), {
        status: "returned",
        isHistorical: true,
      }),
    );

    await assertSucceeds(
      setDoc(doc(db, "rentalFinancials", "rental_history_001"), {
        totalCents: 20000,
        isHistorical: true,
      }),
    );

    await assertSucceeds(
      setDoc(doc(db, "payments", "payment_history_001"), {
        amountCents: 20000,
        isHistorical: true,
      }),
    );

    await assertSucceeds(
      setDoc(doc(db, "idempotencyKeys", "past_rental_001"), {
        response: { rentalId: "rental_history_001" },
      }),
    );
  });

  it("keeps the ledger and audit trail append-only for operations staff", async () => {
    const db = asUser(OPS);

    await assertSucceeds(setDoc(doc(db, "financialLedger", "entry_002"), { amountCents: 100 }));
    await assertFails(updateDoc(doc(db, "financialLedger", "entry_001"), { amountCents: 1 }));
    await assertFails(deleteDoc(doc(db, "financialLedger", "entry_001")));
    await assertFails(updateDoc(doc(db, "auditLogs", "audit_001"), { action: "tampered" }));
    await assertFails(deleteDoc(doc(db, "auditLogs", "audit_001")));
  });

  it("stops an idempotency record being cleared so a payment could be replayed", async () => {
    const db = asUser(OPS);

    await assertSucceeds(setDoc(doc(db, "idempotencyKeys", "payment_002"), { response: {} }));
    await assertFails(deleteDoc(doc(db, "idempotencyKeys", "payment_001")));
    await assertFails(updateDoc(doc(db, "idempotencyKeys", "payment_001"), { response: {} }));
  });

  it("stops staff deleting operational records", async () => {
    const db = asUser(OPS);

    await assertFails(deleteDoc(doc(db, "vehicles", "vehicle_001")));
    await assertFails(deleteDoc(doc(db, "customers", "customer_001")));
    await assertFails(deleteDoc(doc(db, "rentals", "rental_001")));
  });

  it("lets staff claim and release a vehicle uniqueness key", async () => {
    const db = asUser(OPS);

    await assertSucceeds(getDoc(doc(db, "vehicleRegistry", "reg_RT-001")));
    await assertSucceeds(setDoc(doc(db, "vehicleRegistry", "reg_RT-002"), { vehicleId: "vehicle_002", value: "RT-002" }));
    await assertSucceeds(deleteDoc(doc(db, "vehicleRegistry", "reg_RT-002")));
  });

  it("keeps vehicle uniqueness keys away from an unapproved account", async () => {
    const db = asUser(PENDING);

    await assertFails(getDoc(doc(db, "vehicleRegistry", "reg_RT-001")));
    await assertFails(setDoc(doc(db, "vehicleRegistry", "reg_RT-003"), { vehicleId: "x", value: "RT-003" }));
  });

  it("lets staff record a rental extension but never rewrite one", async () => {
    const db = asUser(OPS);

    await assertSucceeds(getDoc(doc(db, "rentals", "rental_001", "extensions", "ext_001")));
    await assertSucceeds(setDoc(doc(db, "rentals", "rental_001", "extensions", "ext_002"), { extensionCents: 2000 }));
    await assertFails(updateDoc(doc(db, "rentals", "rental_001", "extensions", "ext_001"), { extensionCents: 1 }));
    await assertFails(deleteDoc(doc(db, "rentals", "rental_001", "extensions", "ext_001")));
  });

  it("lets staff open a contract for review but never declare it approved", async () => {
    const db = asUser(OPS);

    await assertSucceeds(
      setDoc(doc(db, "reservationContracts", "contract_new"), {
        status: "in_review",
        version: 1,
      }),
    );

    await assertFails(
      setDoc(doc(db, "reservationContracts", "contract_forged"), {
        status: "approved",
        version: 1,
      }),
    );

    await assertFails(
      setDoc(doc(db, "reservationContracts", "contract_skipped"), {
        status: "in_review",
        version: 4,
      }),
    );
  });

  it("lets a rejected contract be resubmitted at the next version only", async () => {
    const db = asUser(OPS);

    await assertFails(
      updateDoc(doc(db, "reservationContracts", "contract_rejected"), {
        status: "in_review",
        version: 1,
      }),
    );

    await assertSucceeds(
      updateDoc(doc(db, "reservationContracts", "contract_rejected"), {
        status: "in_review",
        version: 2,
      }),
    );
  });

  it("keeps the approve and reject decision with an administrator", async () => {
    await assertFails(
      updateDoc(
        doc(asUser(OPS), "reservationContracts", "contract_ops_review"),
        { status: "approved", version: 1 },
      ),
    );

    await assertSucceeds(
      updateDoc(
        doc(asUser(ADMIN), "reservationContracts", "contract_admin_review"),
        { status: "approved", version: 1 },
      ),
    );
  });

  it("lets staff ask for a daily-rate discount only as their own pending request, locked to the booking", async () => {
    const db = asUser(OPS);
    const asked = {
      kind: "daily_rate",
      reservationId: "res_rate",
      rentalId: null,
      discountType: "amount",
      discountValue: 1000,
      originalDailyCents: 7500,
      discountedDailyCents: 6500,
      amountCents: 1000,
      reason: "Long-standing customer",
      status: "pending",
      requestedBy: OPS,
    };
    const request = (id: string, data: Record<string, unknown>) => {
      const batch = writeBatch(db);
      batch.set(doc(db, "rentalDiscounts", id), data);
      batch.update(doc(db, "reservations", "res_rate"), { dailyRateDiscountId: id, dailyRateDiscountStatus: "pending" });
      return batch.commit();
    };

    /* A discount off the balance can no longer be offered. */
    await assertFails(
      setDoc(doc(db, "rentalDiscounts", "flat_discount"), { rentalId: "rental_001", amountCents: 1500, status: "pending", requestedBy: OPS }),
    );
    await assertFails(request("rd_self_approved", { ...asked, status: "approved", reviewedBy: OPS }));
    await assertFails(request("rd_other_name", { ...asked, requestedBy: ADMIN }));
    await assertFails(request("rd_no_reason", { ...asked, reason: " " }));
    await assertFails(request("rd_amounts_disagree", { ...asked, amountCents: 900 }));
    await assertFails(request("rd_value_disagrees", { ...asked, discountValue: 2000 }));
    await assertFails(request("rd_whole_rate", { ...asked, discountValue: 7500, discountedDailyCents: 0, amountCents: 7500 }));
    await assertFails(request("rd_wrong_original", { ...asked, originalDailyCents: 9000, amountCents: 2500, discountValue: 2500 }));
    await assertFails(
      request("rd_percent_wrong", { ...asked, discountType: "percent", discountValue: 20, discountedDailyCents: 5000, amountCents: 2500 }),
    );
    await assertFails(setDoc(doc(db, "rentalDiscounts", "rd_unlocked"), asked));
    await assertSucceeds(
      request("rd_percent", { ...asked, discountType: "percent", discountValue: 12.5, discountedDailyCents: 6563, amountCents: 937 }),
    );

    /* One at a time. */
    await assertFails(request("rd_second", asked));

    await assertSucceeds(
      getDocs(query(collection(db, "rentalDiscounts"), where("rentalId", "==", "rental_001"), where("status", "==", "pending"), limit(1))),
    );
  });

  it("stops staff applying a discounted daily rate themselves", async () => {
    const db = asUser(OPS);
    const cheaper = { currency: "USD", dailyCents: 5000, weeklyCents: 45000, monthlyCents: 150000 };

    await assertFails(updateDoc(doc(db, "reservations", "res_rate"), { rateSnapshot: cheaper }));
    await assertFails(updateDoc(doc(db, "rentals", "rental_rate"), { rateSnapshot: cheaper }));
    await assertFails(
      setDoc(doc(db, "reservations", "res_cheap"), { status: "confirmed", vehicleId: "vehicle_rated", rateSnapshot: cheaper }),
    );
    await assertFails(
      setDoc(doc(db, "reservations", "res_self_approved"), {
        status: "confirmed",
        vehicleId: "vehicle_rated",
        rateSnapshot: { ...cheaper, dailyCents: 7500 },
        dailyRateDiscountStatus: "approved",
      }),
    );
    await assertFails(
      updateDoc(doc(db, "reservations", "res_rate_waiting_2"), { dailyRateDiscountStatus: "approved" }),
    );
    /* A rental checked out by staff carries its booking's rates. */
    await assertFails(
      setDoc(doc(db, "rentals", "rental_cheap"), { status: "active", reservationId: "res_rate", rateSnapshot: cheaper }),
    );
    await assertSucceeds(
      setDoc(doc(db, "reservations", "res_full_rate"), {
        status: "confirmed",
        vehicleId: "vehicle_rated",
        rateSnapshot: { ...cheaper, dailyCents: 7500 },
      }),
    );
  });

  it("keeps the discount decision with an administrator, once, as asked", async () => {
    const admin = asUser(ADMIN);
    const ops = asUser(OPS);
    const discounted = { currency: "USD", dailyCents: 6500, weeklyCents: 45000, monthlyCents: 150000 };
    const decided = { status: "approved", reviewedBy: ADMIN };

    await assertFails(updateDoc(doc(ops, "rentalDiscounts", "rate_pending"), { ...decided, reviewedBy: OPS }));

    /* Approval re-prices the booking in the same write. */
    await assertFails(updateDoc(doc(admin, "rentalDiscounts", "rate_pending"), decided));

    const changed = writeBatch(admin);
    changed.update(doc(admin, "reservations", "res_rate_waiting"), { rateSnapshot: discounted, dailyRateDiscountStatus: "approved" });
    changed.update(doc(admin, "rentalDiscounts", "rate_pending"), { ...decided, discountedDailyCents: 6000 });
    await assertFails(changed.commit());

    const approve = writeBatch(admin);
    approve.update(doc(admin, "reservations", "res_rate_waiting"), { rateSnapshot: discounted, dailyRateDiscountStatus: "approved" });
    approve.update(doc(admin, "rentalDiscounts", "rate_pending"), decided);
    await assertSucceeds(approve.commit());

    await assertFails(updateDoc(doc(admin, "rentalDiscounts", "rate_pending"), { status: "rejected", reviewedBy: ADMIN }));
    await assertSucceeds(
      updateDoc(doc(admin, "rentalDiscounts", "rate_pending_2"), { status: "rejected", reviewedBy: ADMIN, reviewNote: "Not this time" }),
    );

    /* A discount off the balance still waiting from before is still decided here. */
    await assertFails(
      updateDoc(doc(admin, "rentalDiscounts", "discount_pending"), { status: "approved", reviewedBy: ADMIN, amountCents: 9000 }),
    );
    await assertSucceeds(
      updateDoc(doc(admin, "rentalDiscounts", "discount_pending"), { status: "approved", reviewedBy: ADMIN }),
    );
    await assertFails(
      updateDoc(doc(admin, "rentalDiscounts", "discount_decided"), { status: "approved", reviewedBy: ADMIN }),
    );

    /* An administrator's own discount applies as it is written. */
    const own = writeBatch(admin);
    own.set(doc(admin, "rentalDiscounts", "rate_admin_own"), {
      kind: "daily_rate",
      reservationId: "res_rate",
      rentalId: null,
      discountType: "percent",
      discountValue: 20,
      originalDailyCents: 7500,
      discountedDailyCents: 6000,
      amountCents: 1500,
      reason: "Fleet partner",
      status: "approved",
      requestedBy: ADMIN,
      reviewedBy: ADMIN,
    });
    own.update(doc(admin, "reservations", "res_rate"), {
      rateSnapshot: { ...discounted, dailyCents: 6000 },
      dailyRateDiscountId: "rate_admin_own",
      dailyRateDiscountStatus: "approved",
    });
    await assertSucceeds(own.commit());

    await assertFails(deleteDoc(doc(admin, "rentalDiscounts", "discount_decided")));
    await assertFails(deleteDoc(doc(ops, "rentalDiscounts", "rate_pending_2")));
  });

  it("treats an approved contract as final, even for an administrator", async () => {
    await assertFails(
      updateDoc(
        doc(asUser(ADMIN), "reservationContracts", "contract_approved"),
        { status: "in_review", version: 2 },
      ),
    );

    await assertFails(
      deleteDoc(
        doc(asUser(ADMIN), "reservationContracts", "contract_approved"),
      ),
    );
  });

  it("lets only an administrator freeze a contract version, and nobody rewrite one", async () => {
    await assertSucceeds(
      getDoc(
        doc(asUser(OPS), "reservationContracts", "contract_approved", "versions", "v1"),
      ),
    );

    await assertFails(
      setDoc(
        doc(asUser(OPS), "reservationContracts", "contract_approved", "versions", "v9"),
        { version: 9 },
      ),
    );

    await assertSucceeds(
      setDoc(
        doc(asUser(ADMIN), "reservationContracts", "contract_approved", "versions", "v2"),
        { version: 2, baseRentalCents: 16000 },
      ),
    );

    await assertFails(
      updateDoc(
        doc(asUser(ADMIN), "reservationContracts", "contract_approved", "versions", "v1"),
        { baseRentalCents: 1 },
      ),
    );

    await assertFails(
      deleteDoc(
        doc(asUser(ADMIN), "reservationContracts", "contract_approved", "versions", "v1"),
      ),
    );
  });

  it("keeps email delivery receipts append-only", async () => {
    const db = asUser(OPS);

    await assertSucceeds(
      getDoc(
        doc(db, "reservationContracts", "contract_approved", "deliveries", "delivery_001"),
      ),
    );

    await assertSucceeds(
      setDoc(
        doc(db, "reservationContracts", "contract_approved", "deliveries", "delivery_002"),
        { status: "sent", providerMessageId: "msg_002", contractVersion: 1 },
      ),
    );

    await assertFails(
      updateDoc(
        doc(db, "reservationContracts", "contract_approved", "deliveries", "delivery_001"),
        { status: "failed" },
      ),
    );

    await assertFails(
      deleteDoc(
        doc(db, "reservationContracts", "contract_approved", "deliveries", "delivery_001"),
      ),
    );
  });

  it("keeps contracts away from an account that has not been approved", async () => {
    const db = asUser(PENDING);

    await assertFails(
      getDoc(doc(db, "reservationContracts", "contract_approved")),
    );

    await assertFails(
      setDoc(doc(db, "reservationContracts", "contract_pending"), {
        status: "in_review",
        version: 1,
      }),
    );
  });

  /*
   * A collection the application reads but the rules never
   * match falls through to the default deny, and the screen
   * that reads it reports a permission error to a user who
   * has every permission. That has happened twice now — the
   * rental extensions subcollection, and the contract review
   * queue — so every path the client touches is asserted to
   * be matched by a rule rather than reaching the fallthrough.
   *
   * Keep this list in step with lib/services/firestore-client.ts.
   */
  const CLIENT_PATHS: string[][] = [
    ["users", ADMIN],
    ["vehicles", "vehicle_001"],
    ["vehicles", "vehicle_001", "serviceRecords", "service_001"],
    ["vehicleRegistry", "reg_RT-001"],
    ["customers", "customer_001"],
    ["reservations", "reservation_001"],
    ["reservationContracts", "contract_approved"],
    ["reservationContracts", "contract_approved", "versions", "v1"],
    ["reservationContracts", "contract_approved", "deliveries", "delivery_001"],
    ["rentals", "rental_001"],
    ["rentals", "rental_001", "inspections", "inspection_001"],
    ["rentals", "rental_001", "extensions", "ext_001"],
    ["rentalFinancials", "rental_001"],
    ["payments", "payment_001"],
    ["refunds", "refund_001"],
    ["financialLedger", "entry_001"],
    ["vehicleExpenses", "expense_001"],
    ["auditLogs", "audit_001"],
    ["idempotencyKeys", "payment_001"],
    ["rentalDiscounts", "discount_decided"],
    ["cancellationRequests", "cancel_pending_3"],
    ["returnRequests", "return_pending_2"],
  ];

  it("matches every collection the application reads with a rule", async () => {
    const db = asUser(ADMIN);

    for (const path of CLIENT_PATHS) {
      const [first, ...rest] = path;

      await assertSucceeds(
        getDoc(doc(db, first, ...rest)),
      );
    }
  });

  it("lets staff run the review queue query the booking screen issues", async () => {
    /* A get() passing is not evidence that a list() passes: the
       rules engine evaluates a query without a document. This is
       the exact query components/reservation-composer.tsx runs. */
    for (const uid of [OPS, ADMIN]) {
      await assertSucceeds(
        getDocs(
          query(
            collection(asUser(uid), "reservationContracts"),
            where("status", "in", ["in_review", "rejected"]),
            limit(50),
          ),
        ),
      );
    }

    await assertFails(
      getDocs(
        query(
          collection(
            testEnv.unauthenticatedContext().firestore(),
            "reservationContracts",
          ),
          where("status", "in", ["in_review", "rejected"]),
          limit(50),
        ),
      ),
    );
  });

  it("gives an administrator the financial reporting reads", async () => {
    const db = asUser(ADMIN);

    await assertSucceeds(getDoc(doc(db, "rentalFinancials", "rental_001")));
    await assertSucceeds(getDoc(doc(db, "vehicleExpenses", "expense_001")));
    await assertSucceeds(getDoc(doc(db, "financialLedger", "entry_001")));
  });

  it("stops a pending account approving itself or claiming a role", async () => {
    const db = asUser(PENDING);

    await assertFails(updateDoc(doc(db, "users", PENDING), { status: "approved" }));
    await assertFails(updateDoc(doc(db, "users", PENDING), { role: "admin" }));
    await assertSucceeds(updateDoc(doc(db, "users", PENDING), { fullName: "Pending Person" }));
  });

  it("stops staff reading another staff member's profile", async () => {
    await assertFails(getDoc(doc(asUser(OPS), "users", ADMIN)));
    await assertSucceeds(getDoc(doc(asUser(ADMIN), "users", OPS)));
  });

  it("lets an administrator see the approval queue and decide it", async () => {
    const db = asUser(ADMIN);

    await assertSucceeds(
      getDocs(query(collection(db, "users"), where("status", "==", "pending"))),
    );

    await assertSucceeds(
      updateDoc(doc(db, "users", PENDING), {
        status: "approved",
        role: "operations",
        decidedBy: ADMIN,
      }),
    );

    /* Put the fixture back for the tests that follow. */
    await assertSucceeds(
      updateDoc(doc(db, "users", PENDING), { status: "pending", role: null }),
    );
  });

  it("stops operations listing or deciding staff accounts", async () => {
    const db = asUser(OPS);

    await assertFails(getDocs(collection(db, "users")));

    await assertFails(
      updateDoc(doc(db, "users", PENDING), { status: "approved", role: "operations" }),
    );
  });
});
