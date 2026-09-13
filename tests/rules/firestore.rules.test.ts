import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
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
});
