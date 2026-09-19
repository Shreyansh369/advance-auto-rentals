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
  setDoc,
  updateDoc,
  deleteDoc,
  where,
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

    await setDoc(doc(db, "vehicles", "vehicle_001"), { registrationNumber: "RT-001" });
    await setDoc(doc(db, "customers", "customer_001"), { fullName: "Sample Customer" });
    await setDoc(doc(db, "rentalFinancials", "rental_001"), { totalCents: 10000 });
    await setDoc(doc(db, "vehicleExpenses", "expense_001"), { amountCents: 5000 });
    await setDoc(doc(db, "financialLedger", "entry_001"), { amountCents: 5000 });
    await setDoc(doc(db, "auditLogs", "audit_001"), { action: "vehicle.created" });
    await setDoc(doc(db, "idempotencyKeys", "payment_001"), { response: { outstandingCents: 0 } });
    await setDoc(doc(db, "vehicleRegistry", "reg_RT-001"), { vehicleId: "vehicle_001", value: "RT-001" });
    await setDoc(doc(db, "rentals", "rental_001", "extensions", "ext_001"), { extensionCents: 1000 });

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
    await assertSucceeds(setDoc(doc(db, "reservations", "reservation_001"), { status: "confirmed" }));
    await assertSucceeds(setDoc(doc(db, "rentals", "rental_001"), { status: "active" }));
  });

  it("keeps profit reporting away from operations staff", async () => {
    const db = asUser(OPS);

    await assertFails(getDoc(doc(db, "vehicleExpenses", "expense_001")));
    await assertFails(getDoc(doc(db, "financialLedger", "entry_001")));
    await assertFails(getDoc(doc(db, "auditLogs", "audit_001")));
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

  it("lets a pending account record that it announced itself, exactly once", async () => {
    const db = asUser(PENDING);

    const receipt = {
      uid: PENDING,
      fullName: "Pending Person",
      email: "pending@example.test",
      requestedRole: "operations",
      notifiedAt: "2026-09-18T19:28:00.000Z",
      createdAt: "2026-09-18T19:28:00.000Z",
      provider: "resend",
      providerMessageId: "msg_staff_1",
      recipientCount: 2,
    };

    await assertSucceeds(
      setDoc(doc(db, "staffAccessRequests", PENDING), receipt),
    );

    /* A receipt records something that already happened. */
    await assertFails(
      updateDoc(doc(db, "staffAccessRequests", PENDING), {
        notifiedAt: "2026-09-19T08:00:00.000Z",
      }),
    );

    await assertFails(deleteDoc(doc(db, "staffAccessRequests", PENDING)));

    await assertSucceeds(getDoc(doc(db, "staffAccessRequests", PENDING)));
  });

  it("stops an account writing a receipt for somebody else or smuggling fields into one", async () => {
    const db = asUser(PENDING);

    await assertFails(
      setDoc(doc(db, "staffAccessRequests", OPS), { uid: OPS }),
    );

    await assertFails(
      setDoc(doc(db, "staffAccessRequests", PENDING), { uid: ADMIN }),
    );

    await assertFails(
      setDoc(doc(db, "staffAccessRequests", PENDING), {
        uid: PENDING,
        role: "admin",
        status: "approved",
      }),
    );
  });

  it("keeps the receipts to administrators, who may clear one to allow a resend", async () => {
    await assertFails(getDoc(doc(asUser(OPS), "staffAccessRequests", PENDING)));

    const db = asUser(ADMIN);

    await assertSucceeds(getDocs(collection(db, "staffAccessRequests")));
    await assertSucceeds(deleteDoc(doc(db, "staffAccessRequests", PENDING)));
  });
});
