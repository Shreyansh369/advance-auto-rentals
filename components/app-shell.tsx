"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { BarChart3, CalendarDays, CarFront, LayoutDashboard, LogOut, UsersRound, Menu, X } from "lucide-react";
import { useState } from "react";
import { useFirebaseAuth } from "./firebase-provider";
import { getFirebaseClient } from "@/lib/firebase/client";

const navigation = [
  {
    href: "/",
    label: "Overview",
    icon: LayoutDashboard,
  },
  {
    href: "/rentals",
    label: "Bookings",
    icon: CalendarDays,
  },
  {
    href: "/customers",
    label: "Customers",
    icon: UsersRound,
  },
  {
    href: "/vehicles",
    label: "Fleet",
    icon: CarFront,
  },
  {
    href: "/finance",
    label: "Finance",
    icon: BarChart3,
    admin: true,
  },
];

export function AppShell({ children, title, eyebrow, action }: { children: React.ReactNode; title: string; eyebrow?: string; action?: React.ReactNode }) {
  const { user, role } = useFirebaseAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  async function logout() { await signOut(getFirebaseClient().auth); router.replace("/login"); }
  const items = navigation.filter((item) => !item.admin || role === "admin");
  return (
    <div className="app-frame">
      <aside className={`app-sidebar ${open ? "is-open" : ""}`} aria-label="Main navigation">
        <div className="brand-lockup"><span className="brand-mark">A</span><span>Advance<span>Auto Rentals</span></span></div>
        <nav className="sidebar-nav">{items.map(({ href, label, icon: Icon }) => <Link className={pathname === href ? "active" : ""} href={href} onClick={() => setOpen(false)} key={href}><Icon size={19} strokeWidth={2.1} /><span>{label}</span></Link>)}</nav>
        <div className="profile"><div className="avatar">{(user?.email?.[0] ?? "A").toUpperCase()}</div><div><strong>{user?.email?.split("@")[0] ?? "Staff"}</strong><small>{role === "admin" ? "Administrator" : "Operations"}</small></div><button className="icon-button" onClick={() => void logout()} aria-label="Sign out"><LogOut size={18} /></button></div>
      </aside>
      {open && <button className="nav-backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <main className="app-main">
        <header className="app-header"><button className="mobile-menu icon-button" onClick={() => setOpen((value) => !value)} aria-label={open ? "Close menu" : "Open menu"}>{open ? <X /> : <Menu />}</button><div><p className="page-kicker">{eyebrow}</p><h1>{title}</h1></div><div className="header-action">{action}</div></header>
        {children}
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">{items.slice(0, 4).map(({ href, label, icon: Icon }) => <Link href={href} className={pathname === href ? "active" : ""} key={href}><Icon size={19} /><span>{label}</span></Link>)}</nav>
    </div>
  );
}
