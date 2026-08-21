import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { ref, uploadBytes } from "firebase/storage";
import { afterAll, beforeAll, describe, it } from "vitest";

let testEnv: RulesTestEnvironment;
const jpeg = new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" });
beforeAll(async () => { testEnv = await initializeTestEnvironment({ projectId: "advance-auto-rentals-storage-test", storage: { rules: await readFile("storage.rules", "utf8") } }); });
afterAll(async () => { await testEnv.cleanup(); });
describe("Storage access policy", () => {
  it("rejects unauthenticated inspection-photo uploads", async () => { await assertFails(uploadBytes(ref(testEnv.unauthenticatedContext().storage(), "inspection-photos/rental_001/photo_001"), jpeg, { contentType: "image/jpeg" })); });
  it("allows staff to upload a constrained inspection image", async () => { await assertSucceeds(uploadBytes(ref(testEnv.authenticatedContext("ops-user", { role: "operations" }).storage(), "inspection-photos/rental_001/photo_001"), jpeg, { contentType: "image/jpeg" })); });
  it("rejects an executable masquerading as a customer document", async () => { const script = new Blob(["not a document"], { type: "application/javascript" }); await assertFails(uploadBytes(ref(testEnv.authenticatedContext("ops-user", { role: "operations" }).storage(), "customer-documents/customer_001/file_001"), script, { contentType: "application/javascript" })); });
});
