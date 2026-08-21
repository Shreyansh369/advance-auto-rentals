"use client";

import Link from "next/link";
import { AlertTriangle, CalendarArrowDown, CalendarArrowUp, CarFront, CheckCircle2, Clock3, RefreshCw, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "./app-shell";
import { callRentalFunction, type DashboardSummary } from "@/lib/services/functions-client";
import { firebaseErrorMessage, formatDate } from "@/lib/presentation";

const cards: Array<{ key: keyof Omit<DashboardSummary, "upcomingReservations">; label: string; icon: typeof CarFront; tone: string }> = [
  { key: "totalFleet", label: "Fleet", icon: CarFront, tone: "navy" },
  { key: "available", label: "Available", icon: CheckCircle2, tone: "green" },
  { key: "reserved", label: "Reserved", icon: CalendarArrowUp, tone: "blue" },
  { key: "todayPickups", label: "Pickups today", icon: CalendarArrowUp, tone: "purple" },
  { key: "todayReturns", label: "Returns today", icon: CalendarArrowDown, tone: "orange" },
  { key: "overdue", label: "Overdue", icon: Clock3, tone: "red" },
  { key: "maintenanceDue", label: "Service due", icon: Wrench, tone: "orange" },
  { key: "expiringDocuments", label: "Documents due", icon: AlertTriangle, tone: "yellow" },
];

export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); setError(undefined); try { setSummary(await callRentalFunction<Record<string, never>, DashboardSummary>("getOperationalDashboard", {})); } catch (cause) { setError(firebaseErrorMessage(cause)); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  return <AppShell title="Today" eyebrow={new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date())} action={<><button className="button button-secondary compact" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh</button><Link href="/rentals" className="button button-primary header-primary">New booking</Link></>}>
    {error && <div className="alert alert-error" role="alert"><AlertTriangle size={18} />{error}</div>}
    <section className="metric-grid" aria-label="Fleet activity">{cards.map(({ key, label, icon: Icon, tone }) => <article className="metric-card" key={key}><div className={`metric-icon ${tone}`}><Icon size={19} /></div><div><p>{label}</p><strong>{summary ? summary[key] : "—"}</strong></div></article>)}</section>
    {summary?.totalFleet === 0 && <section className="empty-state prominent"><div className="empty-illustration"><CarFront /></div><div><h2>Start with your fleet</h2><p>Import the reviewed inventory before accepting bookings.</p></div><Link className="button button-primary" href="/vehicles">Open fleet</Link></section>}
    <section className="dashboard-grid">
      <article className="surface upcoming-panel"><div className="section-heading"><div><p className="section-kicker">Next 7 days</p><h2>Upcoming pickups</h2></div><Link className="text-link" href="/rentals">View bookings</Link></div>{summary?.upcomingReservations.length ? <div className="list-table">{summary.upcomingReservations.map((reservation) => <div className="pickup-row" key={reservation.id}><div className="pickup-time"><strong>{formatDate(reservation.pickupAt, { month: "short", day: "numeric" })}</strong><span>{new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(reservation.pickupAt))}</span></div><div><strong>{reservation.customerName}</strong><span>{reservation.vehicleRegistration}</span></div><span className="status-pill reserved">Reserved</span></div>)}</div> : <div className="inline-empty">No upcoming pickups.</div>}</article>
      <article className="surface attention-panel"><div className="section-heading"><div><p className="section-kicker">Needs attention</p><h2>Daily checks</h2></div></div><div className="attention-list"><div><span className={summary?.overdue ? "attention-dot danger" : "attention-dot"} /><p><strong>{summary?.overdue ?? 0} overdue rental{summary?.overdue === 1 ? "" : "s"}</strong><span>Follow up before close of day</span></p></div><div><span className={summary?.maintenanceDue ? "attention-dot warning" : "attention-dot"} /><p><strong>{summary?.maintenanceDue ?? 0} service item{summary?.maintenanceDue === 1 ? "" : "s"} due</strong><span>Review fleet readiness</span></p></div><div><span className={summary?.expiringDocuments ? "attention-dot warning" : "attention-dot"} /><p><strong>{summary?.expiringDocuments ?? 0} document{summary?.expiringDocuments === 1 ? "" : "s"} due</strong><span>Registration or insurance</span></p></div></div></article>
    </section>
  </AppShell>;
}
