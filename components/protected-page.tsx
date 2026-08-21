"use client";

import { signOut } from "firebase/auth";
import {
  CheckCircle2,
  LogOut,
  ShieldAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getFirebaseClient } from "@/lib/firebase/client";

import { useFirebaseAuth } from "./firebase-provider";

export function ProtectedPage({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = useFirebaseAuth();
  const router = useRouter();

  const [leaving, setLeaving] =
    useState(false);

  useEffect(() => {
    if (
      auth.status === "ready" &&
      !auth.user
    ) {
      router.replace("/login");
    }
  }, [
    auth.status,
    auth.user,
    router,
  ]);

  async function backToSignIn() {
    setLeaving(true);

    try {
      await signOut(
        getFirebaseClient().auth,
      );

      router.replace("/login");
      router.refresh();
    } catch {
      setLeaving(false);
      router.replace("/login");
    }
  }

  if (
    auth.status === "loading"
  ) {
    return (
      <div className="page-loader">
        <span className="loader-dot" />
        Loading workspace
      </div>
    );
  }

  if (
    auth.status ===
    "config-error"
  ) {
    return (
      <main className="auth-page auth-page-simple">
        <section className="auth-card auth-card-mobile">
          <div className="auth-symbol">
            <ShieldAlert />
          </div>

          <p className="page-kicker">
            Configuration needed
          </p>

          <h1>
            Connect Firebase to continue
          </h1>

          <p className="quiet">
            {auth.message}
          </p>
        </section>
      </main>
    );
  }

  if (!auth.user) {
    return (
      <div className="page-loader">
        Opening sign in…
      </div>
    );
  }

  if (
    !auth.user.emailVerified
  ) {
    return (
      <main className="auth-page auth-page-simple">
        <section className="auth-card auth-card-mobile auth-status-card">
          <div className="auth-symbol">
            <CheckCircle2 />
          </div>

          <p className="page-kicker">
            Verify your email
          </p>

          <h1>
            Email verification required
          </h1>

          <p>
            Verify your email address before you can continue.
          </p>

          <button
            className="button button-secondary"
            type="button"
            onClick={() =>
              void backToSignIn()
            }
            disabled={leaving}
          >
            <LogOut size={17} />

            {leaving
              ? "Signing out…"
              : "Back to sign in"}
          </button>
        </section>
      </main>
    );
  }

  if (!auth.role) {
    return (
      <main className="auth-page auth-page-simple">
        <section className="auth-card auth-card-mobile auth-status-card">
          <div className="auth-symbol">
            <ShieldAlert />
          </div>

          <p className="page-kicker">
            Account pending
          </p>

          <h1>
            You're almost there
          </h1>

          <p>
            Your account has been created and your email is verified.
          </p>

          <div className="pending-box">
            <strong>
              Administrator approval required
            </strong>

            <span>
              Your requested role is waiting for an administrator to review your account.
            </span>
          </div>

          <button
            className="button button-secondary"
            type="button"
            onClick={() =>
              void backToSignIn()
            }
            disabled={leaving}
          >
            <LogOut size={17} />

            {leaving
              ? "Signing out…"
              : "Back to sign in"}
          </button>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}