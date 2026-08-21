export const VEHICLE_STATUSES = [
  "available",
  "reserved",
  "rented",
  "overdue",
  "cleaning",
  "maintenance",
  "out_of_service",
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];
export type UserRole = "admin" | "operations";
export type FuelLevel = "empty" | "quarter" | "half" | "three_quarters" | "full";
export type PaymentMethod = "cash" | "card" | "bank_transfer" | "other";

export interface VehicleRates {
  currency: "USD";
  dailyCents: number | null;
  weeklyCents: number | null;
  monthlyCents: number | null;
}

export interface RateSnapshot extends VehicleRates {
  quotedAt: string;
  vehicleId: string;
  vehicleRegistration: string;
}

export interface RentalPeriod {
  pickupAt: string;
  expectedReturnAt: string;
}

export interface Quote {
  chargedDays: number;
  dailyUnits: number;
  weeklyUnits: number;
  monthlyUnits: number;
  baseRentalCents: number;
  currency: "USD";
}

export interface VehicleDocument {
  registrationNumber: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  vin: string | null;
  registrationExpiresAt: string | null;
  insuranceExpiresAt: string | null;
  lastServiceAt: string | null;
  nextServiceDueAt: string | null;
  rates: VehicleRates;
  status: VehicleStatus;
  notes: string | null;
  photoPaths: string[];
  createdAt: unknown;
  updatedAt: unknown;
}
