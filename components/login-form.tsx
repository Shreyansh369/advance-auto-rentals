"use client";

import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "firebase/auth";

import {
  AlertCircle,
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

import {
  useFirebaseAuth,
} from "./firebase-provider";

export function LoginForm() {
  const auth = useFirebaseAuth();
  const router = useRouter();

  const [error, setError] =
    useState<string>();

  const [notice, setNotice] =
    useState<string>();

  const [submitting, setSubmitting] =
    useState(false);

  const [signingOut, setSigningOut] =
    useState(false);

  /*
   * ---------------------------------------------------------
   * LOGIN
   * ---------------------------------------------------------
   *
   * Authentication is handled by Firebase Auth.
   *
   * Authorization is handled by Firestore:
   *
   * users/{uid}
   *   status = "approved"
   *   role   = "admin" | "operations"
   *
   * We intentionally do NOT require emailVerified here.
   * The account's approved Firestore role is the application
   * access gate.
   */
  async function submit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (submitting) {
      return;
    }

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

    if (!email) {
      setError(
        "Enter your email address.",
      );
      setSubmitting(false);
      return;
    }

    if (!password) {
      setError(
        "Enter your password.",
      );
      setSubmitting(false);
      return;
    }

    try {
      await signInWithEmailAndPassword(
        getFirebaseClient().auth,
        email,
        password,
      );

      /*
       * IMPORTANT:
       *
       * Do not router.replace() here.
       *
       * FirebaseProvider receives the authentication
       * event, resolves users/{uid}, checks:
       *
       *   status === "approved"
       *   role === "admin" | "operations"
       *
       * and only then this component redirects.
       */
    } catch (cause) {
      setError(
        firebaseErrorMessage(cause),
      );
    } finally {
      setSubmitting(false);
    }
  }

  /*
   * ---------------------------------------------------------
   * PASSWORD RESET
   * ---------------------------------------------------------
   */
  async function resetPassword() {
    const field =
      document.getElementById(
        "email",
      ) as HTMLInputElement | null;

    const email =
      field?.value
        .trim()
        .toLowerCase();

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

  /*
   * ---------------------------------------------------------
   * APPROVED USER → DASHBOARD
   * ---------------------------------------------------------
   */
  useEffect(() => {
    if (
      auth.status !== "ready" ||
      !auth.user
    ) {
      return;
    }

    if (auth.role) {
      router.replace("/");
    }
  }, [
    auth.status,
    auth.user,
    auth.role,
    router,
  ]);

  /*
   * ---------------------------------------------------------
   * FIREBASE CONFIG ERROR
   * ---------------------------------------------------------
   */
  if (
    auth.status ===
    "config-error"
  ) {
    return (
      <main className="auth-shell">
        <section className="auth-panel-centered">
          <div className="auth-logo-wrap">
            <img
              src="/brand/logo.svg"
              alt="Advance Auto Rentals"
              className="auth-logo"
            />
          </div>

          <p className="auth-eyebrow">
            CONFIGURATION NEEDED
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

  /*
   * ---------------------------------------------------------
   * INITIAL AUTH LOADING
   * ---------------------------------------------------------
   */
  if (
    auth.status === "loading"
  ) {
    return (
      <div
        className="auth-loading"
        role="status"
        aria-live="polite"
      >
        <span />
        Checking your account
      </div>
    );
  }

  /*
   * ---------------------------------------------------------
   * AUTHENTICATED BUT NOT APPROVED
   * ---------------------------------------------------------
   */
  if (
    auth.status === "ready" &&
    auth.user &&
    !auth.role
  ) {
    async function signOutPendingAccount() {
      if (signingOut) {
        return;
      }

      setSigningOut(true);
      setError(undefined);
      setNotice(undefined);

      try {
        await getFirebaseClient()
          .auth
          .signOut();

        /*
         * Use a hard navigation here.
         * This guarantees that the authenticated
         * application state is discarded and the
         * login page is loaded from a clean state.
         */
        window.location.replace(
          "/login",
        );
      } catch (cause) {
        console.error(
          "Pending-account sign out failed:",
          cause,
        );

        setSigningOut(false);

        setError(
          firebaseErrorMessage(
            cause,
          ),
        );
      }
    }

    return (
      <main className="auth-shell">
        <section className="auth-panel-centered">
          <div className="auth-logo-wrap">
            <img
              src="/brand/logo.svg"
              alt="Advance Auto Rentals"
              className="auth-logo"
            />
          </div>

          <p className="auth-eyebrow">
            ACCESS PENDING
          </p>

          <h1>
            Account awaiting approval
          </h1>

          <p className="auth-description">
            {auth.message ??
              "Your account has not been approved for application access yet."}
          </p>

          {error && (
            <div
              className="auth-message auth-message-error"
              role="alert"
            >
              <AlertCircle size={17} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="button"
            className="auth-outline-button"
            onClick={() =>
              void signOutPendingAccount()
            }
            disabled={signingOut}
          >
            {signingOut
              ? "Signing out…"
              : "Sign out"}
          </button>
        </section>
      </main>
    );
  }

  /*
   * ---------------------------------------------------------
   * APPROVED USER — WAITING FOR NAVIGATION
   * ---------------------------------------------------------
   */
  if (
    auth.status === "ready" &&
    auth.user &&
    auth.role
  ) {
    return (
      <div
        className="auth-loading"
        role="status"
        aria-live="polite"
      >
        <span />
        Opening rental desk
      </div>
    );
  }

  /*
   * ---------------------------------------------------------
   * NORMAL LOGIN PAGE
   * ---------------------------------------------------------
   */
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
              bookings, returns and
              financial activity from one
              workspace.
            </p>

            <div className="showcase-features">
              <div>
                <span className="feature-icon">
                  <ShieldCheck
                    size={17}
                  />
                </span>

                <span>
                  Secure staff access
                </span>
              </div>

              <div>
                <span className="feature-icon">
                  <KeyRound
                    size={17}
                  />
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
              Sign in to access your
              rental operations workspace.
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
                <AlertCircle size={17} />
                <span>{error}</span>
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
                <ArrowRight
                  size={18}
                />
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
            Access is subject to
            administrator approval.
          </p>
        </div>
      </section>
    </main>
  );
}