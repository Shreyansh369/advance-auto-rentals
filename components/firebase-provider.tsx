"use client";

import { doc, getDoc } from "firebase/firestore";
import {
  onAuthStateChanged,
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
      message: string | null;
    };

const FirebaseContext =
  createContext<AuthState>({
    status: "loading",
    user: null,
    role: null,
    message: null,
  });

export function FirebaseProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] =
    useState<AuthState>(() => {
      if (!firebaseEnvironment()) {
        return {
          status: "config-error",
          user: null,
          role: null,
          message:
            "Firebase configuration is missing. Check the environment variables.",
        };
      }

      return {
        status: "loading",
        user: null,
        role: null,
        message: null,
      };
    });

  useEffect(() => {
    if (!firebaseEnvironment()) {
      return;
    }

    let cancelled = false;

    let unsubscribe:
      | (() => void)
      | undefined;

    try {
      const { auth, db } =
        getFirebaseClient();

      unsubscribe =
        onAuthStateChanged(
          auth,
          async (user) => {
            if (cancelled) {
              return;
            }

            /*
             * No authenticated Firebase user.
             *
             * This is a normal signed-out state,
             * not an error.
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
             * Firebase Authentication has confirmed
             * the identity. Now resolve the application's
             * role from Firestore.
             */
            try {
              const profileRef = doc(
                db,
                "users",
                user.uid,
              );

              const profileSnapshot =
                await getDoc(profileRef);

              if (cancelled) {
                return;
              }

              /*
               * Authenticated Firebase account exists,
               * but application profile has not been
               * created yet.
               */
              if (!profileSnapshot.exists()) {
                setState({
                  status: "ready",
                  user,
                  role: null,
                  message:
                    "Your staff profile has not been created yet. Please contact the administrator.",
                });

                return;
              }

              const profile =
                profileSnapshot.data();

              const role: AppRole =
                profile.role === "admin" ||
                profile.role === "operations"
                  ? profile.role
                  : null;

              const status =
                String(
                  profile.status ?? "",
                ).toLowerCase();

              /*
               * A role is only valid when the profile
               * is explicitly approved.
               */
              if (status !== "approved") {
                setState({
                  status: "ready",
                  user,
                  role: null,
                  message:
                    "Your account is awaiting administrator approval.",
                });

                return;
              }

              /*
               * Approved account but invalid/missing role.
               * Do not grant application access.
               */
              if (!role) {
                setState({
                  status: "ready",
                  user,
                  role: null,
                  message:
                    "Your account has been approved but no valid application role has been assigned.",
                });

                return;
              }

              /*
               * Fully authenticated and authorized.
               */
              setState({
                status: "ready",
                user,
                role,
                message: null,
              });
            } catch (error) {
              console.error(
                "Firebase profile lookup failed:",
                error,
              );

              if (cancelled) {
                return;
              }

              /*
               * Keep the Firebase user attached to state.
               *
               * This is important: a Firestore lookup
               * failure must not look like a sign-out.
               * Otherwise the login page can immediately
               * redirect back and forth.
               */
              setState({
                status: "ready",
                user,
                role: null,
                message:
                  error instanceof Error
                    ? `We could not verify your staff profile: ${error.message}`
                    : "We could not verify your staff profile. Please try again.",
              });
            }
          },
        );
    } catch (error) {
      queueMicrotask(() => {
        if (cancelled) {
          return;
        }

        setState({
          status: "config-error",
          user: null,
          role: null,
          message:
            error instanceof Error
              ? error.message
              : "Firebase could not initialize.",
        });
      });
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
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
  return useContext(
    FirebaseContext,
  );
}