"use client";

import { onIdTokenChanged, type User } from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { firebaseEnvironment } from "@/lib/firebase/config";
import { getFirebaseClient } from "@/lib/firebase/client";

export type AppRole = "admin" | "operations" | null;
type AuthState = { status: "config-error"; user: null; role: null; message: string } | { status: "loading"; user: null; role: null; message: null } | { status: "ready"; user: User | null; role: AppRole; message: null };
const FirebaseContext = createContext<AuthState>({ status: "loading", user: null, role: null, message: null });

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(() => firebaseEnvironment() ? { status: "loading", user: null, role: null, message: null } : { status: "config-error", user: null, role: null, message: "Firebase configuration is missing. Copy .env.example to .env.local and use a development Firebase project." });
  useEffect(() => {
    if (!firebaseEnvironment()) return;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = onIdTokenChanged(getFirebaseClient().auth, async (user) => {
        try {
          const result = user ? await user.getIdTokenResult() : null;
          const role = result?.claims.role === "admin" || result?.claims.role === "operations" ? result.claims.role : null;
          setState({ status: "ready", user, role, message: null });
        } catch (error) { setState({ status: "config-error", user: null, role: null, message: error instanceof Error ? error.message : "Session verification failed." }); }
      });
    } catch (error) { queueMicrotask(() => setState({ status: "config-error", user: null, role: null, message: error instanceof Error ? error.message : "Firebase could not initialize." })); }
    return () => unsubscribe?.();
  }, []);
  const value = useMemo(() => state, [state]);
  return <FirebaseContext.Provider value={value}>{children}</FirebaseContext.Provider>;
}

export function useFirebaseAuth() { return useContext(FirebaseContext); }
