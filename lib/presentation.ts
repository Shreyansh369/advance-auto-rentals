import { FirebaseError } from "firebase/app";

export const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function formatMoney(cents: number): string {
  return currency.format(cents / 100);
}

export function formatDate(value: string | null | undefined, options: Intl.DateTimeFormatOptions = {}): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", ...options }).format(date);
}

export function formatFuel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function firebaseErrorMessage(error: unknown): string {
  if (!(error instanceof FirebaseError)) return error instanceof Error ? error.message : "Something went wrong. Please try again.";
  const messages: Record<string, string> = {
    "auth/invalid-credential": "The email address or password is incorrect.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/invalid-api-key": "The Firebase web configuration is invalid. Check the deployed environment variables.",
    "auth/operation-not-allowed": "Email and password sign-in is not enabled in Firebase Authentication.",
    "auth/too-many-requests": "Too many attempts. Wait a moment before trying again or reset the password.",
    "auth/user-disabled": "This account has been disabled. Contact an administrator.",
    "auth/network-request-failed": "Network connection unavailable. Check your connection and try again.",
    "functions/unauthenticated": "Your session has expired. Sign in again.",
    "functions/permission-denied": "Your account does not have permission for this action.",
    "functions/failed-precondition": error.message || "This action cannot be completed in the current state.",
    "functions/already-exists": error.message || "A matching record already exists.",
    "functions/invalid-argument": error.message || "Check the information entered and try again.",
    "functions/unavailable": "The service is temporarily unavailable. Please retry.",
  };
  return messages[error.code] ?? "This action could not be completed. Please try again.";
}
