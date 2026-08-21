import type { CallableRequest } from "firebase-functions/https";
import { HttpsError } from "firebase-functions/https";
import type { UserRole } from "../../../packages/domain/src/types";

const ROLES: readonly UserRole[] = ["admin", "operations"];

export function requireRole(request: CallableRequest<unknown>, ...allowed: UserRole[]): { uid: string; role: UserRole } {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const role = request.auth.token.role;
  if (typeof role !== "string" || !ROLES.includes(role as UserRole) || !allowed.includes(role as UserRole)) {
    throw new HttpsError("permission-denied", "Your role is not permitted to perform this operation.");
  }
  return { uid: request.auth.uid, role: role as UserRole };
}

export function requireAdmin(request: CallableRequest<unknown>): { uid: string; role: "admin" } {
  const actor = requireRole(request, "admin");
  return { ...actor, role: "admin" };
}

export function safeError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof Error && error.message.includes("Expected return")) throw new HttpsError("invalid-argument", error.message);
  console.error("Unexpected trusted-operation failure", { name: error instanceof Error ? error.name : "UnknownError" });
  throw new HttpsError("internal", "The operation could not be completed. No changes were confirmed.");
}
