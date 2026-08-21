"use client";

import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  ArrowRight,
  KeyRound,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useState,
} from "react";

import { getFirebaseClient } from "@/lib/firebase/client";
import {
  firebaseErrorMessage,
} from "@/lib/presentation";
import { useFirebaseAuth } from "./firebase-provider";

export function LoginForm() {
  const auth = useFirebaseAuth();
  const router = useRouter();

  const [error, setError] =
    useState<string>();

  const [notice, setNotice] =
    useState<string>();

  const [submitting, setSubmitting] =
    useState(false);

  async function submit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setError(undefined);
    setNotice(undefined);
    setSubmitting(true);

    const form =
      new FormData(event.currentTarget);

    const email = String(
      form.get("email") ?? "",
    )
      .trim()
      .toLowerCase();

    const password = String(
      form.get("password") ?? "",
    );

    try {
      const credential =
        await signInWithEmailAndPassword(
          getFirebaseClient().auth,
          email,
          password,
        );

      if (
        !credential.user.emailVerified
      ) {
        await getFirebaseClient().auth.signOut();

        setError(
          "Please verify your email address before signing in.",
        );

        return;
      }

      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(
        firebaseErrorMessage(cause),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function resetPassword() {
    const field =
      document.getElementById(
        "email",
      ) as HTMLInputElement | null;

    const email =
      field?.value.trim().toLowerCase();

    setError(undefined);
    setNotice(undefined);

    if (!email) {
      setError(
        "Enter your email address first.",
      );
      return;
    }

    try {
      await sendPasswordResetEmail(
        getFirebaseClient().auth,
        email,
      );

      setNotice(
        "Password reset email sent. Check your inbox.",
      );
    } catch (cause) {
      setError(
        firebaseErrorMessage(cause),
      );
    }
  }

  useEffect(() => {
    if (
      auth.status === "ready" &&
      auth.user
    ) {
      router.replace("/");
    }
  }, [
    auth.status,
    auth.user,
    router,
  ]);

  if (
    auth.status === "config-error"
  ) {
    return (
      <main className="auth-shell">
        <section className="auth-panel auth-panel-centered">
          <div className="auth-logo-wrap">
            <img
              src="/brand/logo.svg"
              alt="Advance Auto Rentals"
              className="auth-logo"
            />
          </div>

          <p className="auth-eyebrow">
            Configuration needed
          </p>

          <h1>
            Connect Firebase to sign in
          </h1>

          <p className="auth-description">
            {auth.message}
          </p>
        </section>
      </main>
    );
  }

  if (
    auth.status === "ready" &&
    auth.user
  ) {
    return (
      <div className="auth-loading">
        <span />
        Opening rental desk
      </div>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-showcase">
        <div className="auth-showcase-inner">
          <div className="brand-block">
            <div className="brand-logo-frame">
              <img
                src="/brand/logo.svg"
                alt="Advance Auto Rentals"
                className="auth-logo"
              />
            </div>

            <div className="brand-copy">
              <strong>
                Advance Auto Rentals
              </strong>

              <span>
                Rental management platform
              </span>
            </div>
          </div>

          <div className="showcase-content">
            <p className="auth-eyebrow">
              OPERATIONS WORKSPACE
            </p>

            <h1>
              Run your fleet.
              <br />
              Without the clutter.
            </h1>

            <p>
              Manage vehicles, customers,
              bookings, returns and financial
              activity from one workspace.
            </p>

            <div className="showcase-features">
              <div>
                <span className="feature-icon">
                  <ShieldCheck size={17} />
                </span>

                <span>
                  Secure staff access
                </span>
              </div>

              <div>
                <span className="feature-icon">
                  <KeyRound size={17} />
                </span>

                <span>
                  Controlled permissions
                </span>
              </div>
            </div>
          </div>

          <div className="showcase-footer">
            Advance Auto Rentals
          </div>
        </div>

        <div className="showcase-orb showcase-orb-one" />
        <div className="showcase-orb showcase-orb-two" />
        <div className="showcase-grid" />
      </section>

      <section className="auth-panel">
        <div className="auth-panel-inner">
          <div className="mobile-brand">
            <div className="brand-logo-frame">
              <img
                src="/brand/logo.svg"
                alt="Advance Auto Rentals"
                className="auth-logo"
              />
            </div>

            <div className="brand-copy">
              <strong>
                Advance Auto Rentals
              </strong>

              <span>
                Rental management
              </span>
            </div>
          </div>

          <div className="auth-heading">
            <p className="auth-eyebrow">
              STAFF SIGN IN
            </p>

            <h2>
              Welcome back
            </h2>

            <p className="auth-description">
              Sign in to access your rental
              operations workspace.
            </p>
          </div>

          <form
            className="auth-form"
            onSubmit={(event) =>
              void submit(event)
            }
          >
            <div className="auth-field">
              <label htmlFor="email">
                Email address
              </label>

              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="name@company.com"
                required
              />
            </div>

            <div className="auth-field">
              <div className="auth-field-label">
                <label htmlFor="password">
                  Password
                </label>

                <button
                  type="button"
                  onClick={() =>
                    void resetPassword()
                  }
                >
                  Reset password
                </button>
              </div>

              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                required
              />
            </div>

            {error && (
              <div
                className="auth-message auth-message-error"
                role="alert"
              >
                {error}
              </div>
            )}

            {notice && (
              <div
                className="auth-message auth-message-success"
                role="status"
              >
                {notice}
              </div>
            )}

            <button
              type="submit"
              className="auth-submit-button"
              disabled={submitting}
            >
              <span>
                {submitting
                  ? "Signing in…"
                  : "Sign in"}
              </span>

              {!submitting && (
                <ArrowRight size={18} />
              )}
            </button>
          </form>

          <div className="auth-separator">
            <span />
            <small>
              NEW STAFF
            </small>
            <span />
          </div>

          <button
            type="button"
            className="auth-outline-button"
            onClick={() =>
              router.push("/signup")
            }
          >
            <UserPlus size={17} />
            Create staff account
          </button>

          <p className="auth-footnote">
            Access is subject to administrator
            approval.
          </p>
        </div>
      </section>
    </main>
  );
}