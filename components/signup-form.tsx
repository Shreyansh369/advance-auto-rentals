"use client";

import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
} from "firebase/auth";

import {
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { getFirebaseClient } from "@/lib/firebase/client";

import {
  firebaseErrorMessage,
} from "@/lib/presentation";

export function SignupForm() {
  const router = useRouter();

  const [submitting, setSubmitting] =
    useState(false);

  const [error, setError] =
    useState<string>();

  const [notice, setNotice] =
    useState<string>();

  async function submit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setError(undefined);
    setNotice(undefined);
    setSubmitting(true);

    const form =
      new FormData(event.currentTarget);

    const fullName = String(
      form.get("fullName") ?? "",
    ).trim();

    const mobile = String(
      form.get("mobile") ?? "",
    ).trim();

    const age = Number(
      form.get("age"),
    );

    const email = String(
      form.get("email") ?? "",
    )
      .trim()
      .toLowerCase();

    const requestedRole = String(
      form.get("requestedRole") ?? "",
    );

    const password = String(
      form.get("password") ?? "",
    );

    try {
      /*
       * -------------------------------------------------------
       * Validate input
       * -------------------------------------------------------
       */

      if (fullName.length < 2) {
        throw new Error(
          "Enter your full name.",
        );
      }

      if (mobile.length < 7) {
        throw new Error(
          "Enter a valid mobile number.",
        );
      }

      if (
        !Number.isInteger(age) ||
        age < 18 ||
        age > 100
      ) {
        throw new Error(
          "Enter a valid age.",
        );
      }

      if (
        requestedRole !== "admin" &&
        requestedRole !== "operations"
      ) {
        throw new Error(
          "Select a requested role.",
        );
      }

      if (password.length < 8) {
        throw new Error(
          "Password must be at least 8 characters.",
        );
      }

      /*
       * -------------------------------------------------------
       * Firebase initialization
       * -------------------------------------------------------
       */

      const { auth, db } =
        getFirebaseClient();

      /*
       * -------------------------------------------------------
       * Create Firebase Authentication account
       * -------------------------------------------------------
       */

      const credential =
        await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        );

      /*
       * Keep the user's display name in Firebase Auth.
       */

      await updateProfile(
        credential.user,
        {
          displayName: fullName,
        },
      );

      /*
       * Email verification is required before
       * normal application access.
       */

      await sendEmailVerification(
        credential.user,
      );

      /*
       * -------------------------------------------------------
       * Create application staff profile
       * -------------------------------------------------------
       *
       * users/{uid}
       *
       * role:
       *   null until administrator approval
       *
       * requestedRole:
       *   role requested during signup
       *
       * status:
       *   pending until administrator approval
       */

      const profileRef = doc(
        db,
        "users",
        credential.user.uid,
      );

      await runTransaction(
        db,
        async (transaction) => {
          const existing =
            await transaction.get(
              profileRef,
            );

          if (existing.exists()) {
            throw new Error(
              "A staff profile already exists for this account.",
            );
          }

          transaction.set(
            profileRef,
            {
              fullName,
              mobile,
              age,
              email,

              requestedRole:
                requestedRole as
                  | "admin"
                  | "operations",

              role: null,

              status: "pending",

              emailVerified: false,

              createdAt:
                serverTimestamp(),

              updatedAt:
                serverTimestamp(),
            },
          );
        },
      );

      /*
       * -------------------------------------------------------
       * End the temporary authenticated session
       * -------------------------------------------------------
       *
       * The user must verify their email and then
       * sign in through the normal login flow.
       */

      await auth.signOut();

      /*
       * -------------------------------------------------------
       * Success
       * -------------------------------------------------------
       */

      setNotice(
        "Account created successfully. Verify your email and wait for administrator approval.",
      );

      /*
       * Navigate immediately after signOut().
       *
       * No timeout.
       * No router.refresh().
       *
       * This prevents the signup/login pages from racing
       * against Firebase authentication state changes.
       */

      router.replace("/login");
    } catch (cause) {
      /*
       * If Authentication succeeded but a later step failed,
       * make sure we don't leave the user stuck in a newly
       * authenticated state.
       */

      try {
        await getFirebaseClient()
          .auth
          .signOut();
      } catch {
        // Ignore cleanup failure.
      }

      setError(
        firebaseErrorMessage(cause),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-showcase auth-showcase-signup">
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
                Staff registration
              </span>
            </div>
          </div>

          <div className="showcase-content">
            <p className="auth-eyebrow">
              STAFF ONBOARDING
            </p>

            <h1>
              Join the
              <br />
              operations team.
            </h1>

            <p>
              Create your staff account and
              request the role that matches
              your responsibilities.
            </p>

            <div className="showcase-features">
              <div>
                <span className="feature-number">
                  01
                </span>

                <span>
                  Create your account
                </span>
              </div>

              <div>
                <span className="feature-number">
                  02
                </span>

                <span>
                  Verify your email
                </span>
              </div>

              <div>
                <span className="feature-number">
                  03
                </span>

                <span>
                  Wait for approval
                </span>
              </div>
            </div>
          </div>

          <div className="showcase-footer">
            Secure staff onboarding
          </div>
        </div>

        <div className="showcase-orb showcase-orb-one" />
        <div className="showcase-orb showcase-orb-two" />
        <div className="showcase-grid" />
      </section>

      <section className="auth-panel">
        <div className="auth-panel-inner auth-panel-wide">
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
                Staff registration
              </span>
            </div>
          </div>

          <div className="auth-heading">
            <button
              type="button"
              className="auth-back-button"
              onClick={() =>
                router.push("/login")
              }
            >
              <ArrowLeft size={16} />
              Back to sign in
            </button>

            <p className="auth-eyebrow">
              CREATE ACCOUNT
            </p>

            <h2>
              Staff registration
            </h2>

            <p className="auth-description">
              Provide your details and select
              the role you want to request.
            </p>
          </div>

          <form
            className="auth-form auth-form-grid"
            onSubmit={(event) =>
              void submit(event)
            }
          >
            <div className="auth-field">
              <label htmlFor="fullName">
                Full name
              </label>

              <input
                id="fullName"
                name="fullName"
                type="text"
                autoComplete="name"
                placeholder="Your full name"
                required
              />
            </div>

            <div className="auth-field">
              <label htmlFor="mobile">
                Mobile number
              </label>

              <input
                id="mobile"
                name="mobile"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="+91..."
                required
              />
            </div>

            <div className="auth-field">
              <label htmlFor="age">
                Age
              </label>

              <input
                id="age"
                name="age"
                type="number"
                min={18}
                max={100}
                placeholder="18+"
                required
              />
            </div>

            <div className="auth-field">
              <label htmlFor="requestedRole">
                Requested role
              </label>

              <select
                id="requestedRole"
                name="requestedRole"
                defaultValue=""
                required
              >
                <option value="">
                  Select a role
                </option>

                <option value="operations">
                  Operations
                </option>

                <option value="admin">
                  Administrator
                </option>
              </select>
            </div>

            <div className="auth-field auth-field-full">
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

            <div className="auth-field auth-field-full">
              <label htmlFor="password">
                Password
              </label>

              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                placeholder="At least 8 characters"
                required
              />

              <small className="auth-help">
                Minimum 8 characters.
              </small>
            </div>

            {error && (
              <div
                className="auth-message auth-message-error auth-field-full"
                role="alert"
              >
                {error}
              </div>
            )}

            {notice && (
              <div
                className="auth-message auth-message-success auth-field-full"
                role="status"
              >
                <CheckCircle2 size={17} />
                {notice}
              </div>
            )}

            <div className="auth-field-full">
              <button
                type="submit"
                className="auth-submit-button"
                disabled={submitting}
              >
                <span>
                  {submitting
                    ? "Creating account…"
                    : "Create account"}
                </span>

                {!submitting && (
                  <ArrowRight size={18} />
                )}
              </button>
            </div>
          </form>

          <p className="auth-footnote">
            New accounts require email
            verification and administrator
            approval.
          </p>
        </div>
      </section>
    </main>
  );
}