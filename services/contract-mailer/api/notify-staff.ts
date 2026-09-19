import { readEnv } from "../src/env";
import { handleStaffNotification } from "../src/staff-handler";

/*
 * Deployment entry point for the staff access notifications.
 *
 * It shares the mail provider credential and the Firestore
 * access of `send-contract.ts`, so both routes belong to the
 * same deployment; only the path differs.
 */
export default async function handler(
  request: Request,
): Promise<Response> {
  return handleStaffNotification(
    request,
    readEnv(
      process.env as Record<
        string,
        string | undefined
      >,
    ),
  );
}
