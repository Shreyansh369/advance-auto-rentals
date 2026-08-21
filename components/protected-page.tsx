"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ShieldAlert } from "lucide-react";
import { useFirebaseAuth } from "./firebase-provider";

export function ProtectedPage({ children }: { children: React.ReactNode }) {
  const auth = useFirebaseAuth();
  const router = useRouter();
  useEffect(() => { if (auth.status === "ready" && !auth.user) router.replace("/login"); }, [auth, router]);
  if (auth.status === "loading") return <div className="page-loader"><span className="loader-dot" /> Loading workspace</div>;
  if (auth.status === "config-error") return <main className="auth-page"><section className="auth-card"><div className="auth-symbol"><ShieldAlert /></div><p className="page-kicker">Configuration needed</p><h1>Connect Firebase to continue</h1><p>{auth.message}</p><p className="quiet">Follow the setup guide before inviting staff.</p></section></main>;
  if (!auth.user) return <div className="page-loader">Opening sign in…</div>;
  if (!auth.role) return <main className="auth-page"><section className="auth-card"><div className="auth-symbol"><ShieldAlert /></div><p className="page-kicker">Access pending</p><h1>Your account is not assigned</h1><p>Sign-in succeeded, but this account has not been assigned an Operations or Administrator role yet.</p><p className="quiet">Ask an administrator to assign your role, then sign out and sign in again.</p><button className="button button-secondary" onClick={() => router.replace("/login")}>Back to sign in</button></section></main>;
  return <>{children}</>;
}
