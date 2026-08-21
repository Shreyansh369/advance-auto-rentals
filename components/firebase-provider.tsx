"use client";

import {
  onIdTokenChanged,
  type User,
} from "firebase/auth";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { firebaseEnvironment } from "@/lib/firebase/config";
import { getFirebaseClient } from "@/lib/firebase/client";

export type AppRole =
  | "admin"
  | "operations"
  | null;

type AuthState =
  | {
      status: "config-error";
      user: null;
      role: null;
      message: string;
    }
  | {
      status: "loading";
      user: null;
      role: null;
      message: null;
    }
  | {
      status: "ready";
      user: User | null;
      role: AppRole;
      message: null;
    };

const FirebaseContext =
  createContext<AuthState>({
    status: "loading",
    user: null,
    role: null,
    message: null,
  });

function getDemoAdminEmail() {
  return (
    process.env
      .NEXT_PUBLIC_DEMO_ADMIN_EMAIL
      ?.trim()
      .toLowerCase() || ""
  );
}

export function FirebaseProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] =
    useState<AuthState>(() =>
      firebaseEnvironment()
        ? {
            status: "loading",
            user: null,
            role: null,
            message: null,
          }
        : {
            status: "config-error",
            user: null,
            role: null,
            message:
              "Firebase configuration is missing. Check the Vercel environment variables.",
          },
    );

  useEffect(() => {
    if (!firebaseEnvironment()) {
      return;
    }

    let unsubscribe:
      | (() => void)
      | undefined;

    try {
      unsubscribe = onIdTokenChanged(
        getFirebaseClient().auth,
        async (user) => {
          try {
            /*
             * No authenticated user.
             */
            if (!user) {
              setState({
                status: "ready",
                user: null,
                role: null,
                message: null,
              });

              return;
            }

            /*
             * Normal production role lookup:
             * Firebase custom claim.
             */
            const result =
              await user.getIdTokenResult();

            let role: AppRole =
              result.claims.role ===
                "admin" ||
              result.claims.role ===
                "operations"
                ? result.claims.role
                : null;

            /*
             * TEMPORARY CLIENT DEMO FALLBACK
             *
             * This allows one explicitly configured
             * Firebase account to act as the demo
             * administrator without requiring a
             * deployed Cloud Function/custom claim.
             *
             * Remove this before production.
             */
            const demoAdminEmail =
              getDemoAdminEmail();

            if (
              demoAdminEmail &&
              user.email
                ?.trim()
                .toLowerCase() ===
                demoAdminEmail
            ) {
              role = "admin";
            }

            setState({
              status: "ready",
              user,
              role,
              message: null,
            });
          } catch (error) {
            console.error(
              "Firebase session verification failed",
              error,
            );

            setState({
              status: "config-error",
              user: null,
              role: null,
              message:
                error instanceof Error
                  ? error.message
                  : "Session verification failed.",
            });
          }
        },
      );
    } catch (error) {
      queueMicrotask(() =>
        setState({
          status: "config-error",
          user: null,
          role: null,
          message:
            error instanceof Error
              ? error.message
              : "Firebase could not initialize.",
        }),
      );
    }

    return () =>
      unsubscribe?.();
  }, []);

  const value = useMemo(
    () => state,
    [state],
  );

  return (
    <FirebaseContext.Provider
      value={value}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebaseAuth() {
  return useContext(FirebaseContext);
}