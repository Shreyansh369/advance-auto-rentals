"use client";

import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { ArrowRight, KeyRound, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getFirebaseClient } from "@/lib/firebase/client";
import { firebaseErrorMessage } from "@/lib/presentation";
import { useFirebaseAuth } from "./firebase-provider";

export function LoginForm() {
  const auth = useFirebaseAuth();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined); setNotice(undefined); setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      await signInWithEmailAndPassword(getFirebaseClient().auth, String(form.get("email")).trim(), String(form.get("password")));
      router.replace("/");
    } catch (cause) { setError(firebaseErrorMessage(cause)); } finally { setSubmitting(false); }
  }
  async function resetPassword() {
    const field = document.getElementById("email") as HTMLInputElement | null;
    const email = field?.value.trim();
    setError(undefined); setNotice(undefined);
    if (!email) { setError("Enter your email address first, then select Reset password."); return; }
    try { await sendPasswordResetEmail(getFirebaseClient().auth, email); setNotice("Password reset email sent. Check your inbox and spam folder."); }
    catch (cause) { setError(firebaseErrorMessage(cause)); }
  }
  if (auth.status === "config-error") return <main className="auth-page"><section className="auth-card"><div className="auth-symbol"><ShieldCheck /></div><p className="page-kicker">Configuration needed</p><h1>Connect Firebase to sign in</h1><p>{auth.message}</p></section></main>;
  useEffect(() => {
  if (auth.status === "ready" && auth.user) {
    router.replace("/");
  }
}, [auth.status, auth.user, router]);
if (auth.status === "ready" && auth.user) {
  return <div className="loading">Redirecting…</div>;
}
  return <main className="auth-page"><section className="login-showcase"><div className="brand-lockup"><span className="brand-mark">A</span><span>Advance<span>Auto Rentals</span></span></div><div><p className="page-kicker">Rental management</p><h1>Keep every booking moving.</h1><p>One secure workspace for your fleet, bookings and day-to-day operations.</p></div><div className="showcase-points"><span><ShieldCheck size={17} /> Secure staff access</span><span><KeyRound size={17} /> Password recovery</span></div></section><section className="auth-card login-card"><p className="page-kicker">Staff sign in</p><h1>Welcome back</h1><p className="quiet">Use your work account to access the rental desk.</p><form onSubmit={(event) => void submit(event)}><div className="field"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="email" inputMode="email" required /></div><div className="field"><div className="label-row"><label htmlFor="password">Password</label><button type="button" className="text-button" onClick={() => void resetPassword()}>Reset password</button></div><input id="password" name="password" type="password" autoComplete="current-password" required /></div><button className="button button-primary" disabled={submitting}>{submitting ? "Signing in…" : <>Sign in <ArrowRight size={17} /></>}</button>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}</form></section></main>;
}
