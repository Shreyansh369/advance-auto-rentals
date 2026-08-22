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

    const { auth, db } =
      getFirebaseClient();

    const unsubscribe =
      onAuthStateChanged(
        auth,
        async (user) => {
          if (cancelled) {
            return;
          }

          /*
           * Signed out.
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
           * An unverified email must never enter the
           * application authorization flow.
           *
           * This prevents the race where LoginForm starts
           * signing the user out while this listener sees
           * the newly authenticated Firebase user and
           * incorrectly displays "Account awaiting approval".
           */
          if (!user.emailVerified) {
            setState({
              status: "ready",
              user: null,
              role: null,
              message:
                "Please verify your email address before signing in.",
            });

            try {
              await auth.signOut();
            } catch (error) {
              console.error(
                "Unable to clear unverified Firebase session:",
                error,
              );
            }

            return;
          }

          try {
            /*
             * Only verified Firebase users reach the
             * Firestore staff-profile lookup.
             */
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
             * Only approved users receive an application role.
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
             * Approved but malformed profile.
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
              "Firebase staff profile lookup failed:",
              error,
            );

            if (cancelled) {
              return;
            }

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

    return () => {
      cancelled = true;
      unsubscribe();
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