import type { CallableRequest } from "firebase-functions/https";
import { HttpsError } from "firebase-functions/https";
import type { UserRole } from "../../../packages/domain/src/types";
import { db } from "./firebase";

const ROLES: readonly UserRole[] = ["admin", "operations"];

export async function requireRole(
  request: CallableRequest<unknown>,
  ...allowed: UserRole[]
): Promise<{ uid: string; role: UserRole }> {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Sign-in is required.",
    );
  }

  const uid = request.auth.uid;
  const profileSnapshot = await db
    .collection("users")
    .doc(uid)
    .get();

  if (!profileSnapshot.exists) {
    throw new HttpsError(
      "permission-denied",
      "Your staff account is not approved for application access.",
    );
  }

  const profile = profileSnapshot.data() ?? {};
  const role = profile.role;
  const status = String(profile.status ?? "").toLowerCase();

  if (status !== "approved") {
    throw new HttpsError(
      "permission-denied",
      "Your staff account is not approved for application access.",
    );
  }

  if (
    typeof role !== "string" ||
    !ROLES.includes(role as UserRole) ||
    !allowed.includes(role as UserRole)
  ) {
    throw new HttpsError(
      "permission-denied",
      "Your role is not permitted to perform this operation.",
    );
  }

  return {
    uid,
    role: role as UserRole,
  };
}

export async function requireAdmin(
  request: CallableRequest<unknown>,
): Promise<{ uid: string; role: "admin" }> {
  const actor = await requireRole(request, "admin");
  return { ...actor, role: "admin" };
}

export function safeError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof Error && error.message.includes("Expected return")) throw new HttpsError("invalid-argument", error.message);
  console.error("Unexpected trusted-operation failure", { name: error instanceof Error ? error.name : "UnknownError" });
  throw new HttpsError("internal", "The operation could not be completed. No changes were confirmed.");
}
