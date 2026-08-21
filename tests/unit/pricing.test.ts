import { describe, expect, it } from "vitest";
import { calculateBalance, chargedRentalDays, quoteRental } from "../../packages/domain/src/pricing";
import { isValidVehicleTransition } from "../../packages/domain/src/lifecycle";

const rates = { currency: "USD" as const, dailyCents: 7_500, weeklyCents: 45_000, monthlyCents: 150_000 };
describe("rental pricing", () => {
  it("charges a same-day rental as one day", () => expect(chargedRentalDays({ pickupAt: "2026-08-20T08:00:00.000Z", expectedReturnAt: "2026-08-20T17:00:00.000Z" })).toBe(1));
  it("selects the least costly valid rate bundle and snapshots cents", () => expect(quoteRental({ pickupAt: "2026-08-20T08:00:00.000Z", expectedReturnAt: "2026-09-19T08:00:00.000Z" }, rates)).toMatchObject({ chargedDays: 30, monthlyUnits: 1, baseRentalCents: 150_000 }));
  it("uses weekly rates when they beat daily rates", () => expect(quoteRental({ pickupAt: "2026-08-20T08:00:00.000Z", expectedReturnAt: "2026-08-27T08:00:00.000Z" }, rates)).toMatchObject({ weeklyUnits: 1, baseRentalCents: 45_000 }));
  it("rejects an impossible rental period", () => expect(() => chargedRentalDays({ pickupAt: "2026-08-21T08:00:00.000Z", expectedReturnAt: "2026-08-20T08:00:00.000Z" })).toThrow("Expected return"));
  it("keeps payments and refunds in integer-cent balance calculations", () => expect(calculateBalance(100_00, 75_00, 10_00)).toBe(35_00));
});
describe("vehicle lifecycle", () => {
  it("allows only defined transitions", () => { expect(isValidVehicleTransition("reserved", "rented")).toBe(true); expect(isValidVehicleTransition("out_of_service", "rented")).toBe(false); });
});
