import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

let testEnv: RulesTestEnvironment;
beforeAll(async () => { testEnv = await initializeTestEnvironment({ projectId: "advance-auto-rentals-test", firestore: { rules: await readFile("firestore.rules", "utf8") } }); await testEnv.withSecurityRulesDisabled(async (context) => { await setDoc(doc(context.firestore(), "vehicles", "vehicle_001"), { registrationNumber: "RT-001" }); await setDoc(doc(context.firestore(), "rentalFinancials", "rental_001"), { totalCents: 10000 }); }); });
afterAll(async () => { await testEnv.cleanup(); });
describe("Firestore access policy", () => {
  it("denies unauthenticated fleet reads", async () => { await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "vehicles", "vehicle_001"))); });
  it("allows staff to read fleet but not write it directly", async () => { const db = testEnv.authenticatedContext("ops-user", { role: "operations" }).firestore(); await assertSucceeds(getDoc(doc(db, "vehicles", "vehicle_001"))); await assertFails(setDoc(doc(db, "vehicles", "vehicle_002"), { registrationNumber: "RT-002" })); });
  it("does not expose financial records to operations staff", async () => { await assertFails(getDoc(doc(testEnv.authenticatedContext("ops-user", { role: "operations" }).firestore(), "rentalFinancials", "rental_001"))); });
  it("allows an administrator to read financial records but not mutate them", async () => { const db = testEnv.authenticatedContext("admin-user", { role: "admin" }).firestore(); await assertSucceeds(getDoc(doc(db, "rentalFinancials", "rental_001"))); await assertFails(setDoc(doc(db, "rentalFinancials", "rental_001"), { totalCents: 1 })); });
});
