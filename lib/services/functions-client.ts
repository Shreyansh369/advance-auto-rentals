"use client";

import { httpsCallable } from "firebase/functions";
import { getFirebaseClient } from "@/lib/firebase/client";

export type DashboardSummary = { totalFleet: number; available: number; reserved: number; todayPickups: number; todayReturns: number; overdue: number; maintenanceDue: number; expiringDocuments: number; upcomingReservations: Array<{ id: string; pickupAt: string; customerName: string; vehicleRegistration: string }> };
export type FinancialOverview = { from: string; to: string; invoicedCents: number; receivedCents: number; refundedCents: number; expensesCents: number; netCashCents: number; operatingMarginCents: number; outstandingCents: number; outstandingRentals: number; vehiclePerformance: Array<{ vehicleId: string; vehicleRegistration: string; invoicedCents: number; expensesCents: number; receivedCents: number; operatingMarginCents: number }>; recentEntries: Array<{ id: string; entryType: string; vehicleRegistration: string; amountCents: number; occurredAt: string }> };

export async function callRentalFunction<TInput, TResult>(name: string, data: TInput): Promise<TResult> {
  const callable = httpsCallable<TInput, TResult>(getFirebaseClient().functions, name, { timeout: 30_000 });
  const result = await callable(data);
  return result.data;
}
