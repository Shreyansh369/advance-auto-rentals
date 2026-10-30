import { describe, expect, it } from "vitest";
import { calculateBalance, chargedRentalDays, discountedDailyCents, quoteRental, rentOwedThrough, withDailyRate } from "../../packages/domain/src/pricing";
import { isValidVehicleTransition } from "../../packages/domain/src/lifecycle";
import { pickupWindowError } from "../../packages/domain/src/booking";

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

describe("booking pickup window", () => {
  const now = Date.parse("2026-09-21T12:00:00.000Z");
  const hours = (count: number) => now + count * 3_600_000;
  it("takes an ordinary booking for a pickup ahead of now", () => expect(pickupWindowError({ pickupAtMs: hours(2), nowMs: now, backdated: false })).toBeNull());
  it("refuses an ordinary booking dated in the past", () => expect(pickupWindowError({ pickupAtMs: hours(-2), nowMs: now, backdated: false })).toContain("cannot be in the past"));
  it("takes a backdated booking for a hire that is already out", () => expect(pickupWindowError({ pickupAtMs: hours(-24 * 30), nowMs: now, backdated: true })).toBeNull());
  it("refuses a backdated booking dated in the future", () => expect(pickupWindowError({ pickupAtMs: hours(2), nowMs: now, backdated: true })).toContain("cannot be picked up in the future"));
  it("refuses a backdate beyond two years, which is a mistyped year", () => expect(pickupWindowError({ pickupAtMs: Date.parse("2016-09-21T12:00:00.000Z"), nowMs: now, backdated: true })).toContain("two years"));
  it("refuses an unparseable pickup", () => expect(pickupWindowError({ pickupAtMs: Number.NaN, nowMs: now, backdated: true })).toContain("valid pickup"));
});

describe("rent owed on a long hire", () => {
  const pickupAt = "2026-08-01T08:00:00.000Z";
  it("charges the next week of a hire paid a week up front", () =>
    expect(rentOwedThrough({ pickupAt, chargedThroughAt: "2026-08-08T08:00:00.000Z", throughAt: "2026-08-15T08:00:00.000Z", baseRentalCents: 45_000 }, rates)).toBe(45_000));
  it("moves a hire onto the monthly rate once that is cheaper", () =>
    expect(rentOwedThrough({ pickupAt, chargedThroughAt: "2026-08-22T08:00:00.000Z", throughAt: "2026-08-31T08:00:00.000Z", baseRentalCents: 135_000 }, rates)).toBe(15_000));
  it("charges a part day past the paid date as a full day", () =>
    expect(rentOwedThrough({ pickupAt, chargedThroughAt: "2026-08-08T08:00:00.000Z", throughAt: "2026-08-08T12:00:00.000Z", baseRentalCents: 45_000 }, rates)).toBe(7_500));
  it("owes nothing for a date already paid for", () =>
    expect(rentOwedThrough({ pickupAt, chargedThroughAt: "2026-08-08T08:00:00.000Z", throughAt: "2026-08-05T08:00:00.000Z", baseRentalCents: 45_000 }, rates)).toBe(0));
});

describe("daily-rate discount", () => {
  const pickupAt = "2026-08-01T08:00:00.000Z";
  const days = (count: number) => new Date(Date.parse(pickupAt) + count * 86_400_000).toISOString();

  it("takes a dollar discount off the daily rate", () => expect(discountedDailyCents(7_500, { type: "amount", value: 1_000 })).toBe(6_500));
  it("takes a percentage off the daily rate", () => expect(discountedDailyCents(7_500, { type: "percent", value: 20 })).toBe(6_000));
  it("rounds a percentage to whole cents", () => {
    expect(discountedDailyCents(7_499, { type: "percent", value: 12.5 })).toBe(6_562); // 6561.625
    expect(discountedDailyCents(1_001, { type: "percent", value: 50 })).toBe(501); // 500.5 rounds up
    expect(discountedDailyCents(999, { type: "percent", value: 33.3 })).toBe(666); // 666.333
  });
  it("refuses a dollar discount that is nothing or the whole rate", () => {
    expect(() => discountedDailyCents(7_500, { type: "amount", value: 0 })).toThrow("more than $0");
    expect(() => discountedDailyCents(7_500, { type: "amount", value: 7_500 })).toThrow("less than the daily rate");
    expect(() => discountedDailyCents(7_500, { type: "amount", value: 12.5 })).toThrow();
  });
  it("refuses a percentage outside 0 to 100", () => {
    expect(() => discountedDailyCents(7_500, { type: "percent", value: 0 })).toThrow("more than 0%");
    expect(() => discountedDailyCents(7_500, { type: "percent", value: 100 })).toThrow("less than 100%");
  });
  it("refuses a vehicle with no daily rate", () => expect(() => discountedDailyCents(0, { type: "percent", value: 10 })).toThrow("no daily rate"));
  it("changes only the daily rate", () =>
    expect(withDailyRate(rates, 6_000)).toEqual({ currency: "USD", dailyCents: 6_000, weeklyCents: 45_000, monthlyCents: 150_000 }));

  it("prices a hire at the discounted daily rate", () =>
    expect(quoteRental({ pickupAt, expectedReturnAt: days(3) }, withDailyRate(rates, 6_000))).toMatchObject({ dailyUnits: 3, baseRentalCents: 18_000 }));

  it("keeps the weekly rate when it is still cheaper than seven discounted days", () =>
    expect(quoteRental({ pickupAt, expectedReturnAt: days(7) }, withDailyRate(rates, 7_000))).toMatchObject({ weeklyUnits: 1, dailyUnits: 0, baseRentalCents: 45_000 }));

  it("chooses discounted days over the weekly rate once they are cheaper", () =>
    expect(quoteRental({ pickupAt, expectedReturnAt: days(7) }, withDailyRate(rates, 6_000))).toMatchObject({ weeklyUnits: 0, dailyUnits: 7, baseRentalCents: 42_000 }));

  it("mixes a week with discounted days on a longer hire", () =>
    expect(quoteRental({ pickupAt, expectedReturnAt: days(9) }, withDailyRate(rates, 7_000))).toMatchObject({ weeklyUnits: 1, dailyUnits: 2, baseRentalCents: 59_000 }));

  it("drops the week for nine discounted days when they come out cheaper", () =>
    expect(quoteRental({ pickupAt, expectedReturnAt: days(9) }, withDailyRate(rates, 6_000))).toMatchObject({ weeklyUnits: 0, dailyUnits: 9, baseRentalCents: 54_000 }));

  it("charges an extension at the discounted daily rate", () => {
    const discounted = withDailyRate(rates, 6_000);
    const before = quoteRental({ pickupAt, expectedReturnAt: days(2) }, discounted).baseRentalCents;
    const after = quoteRental({ pickupAt, expectedReturnAt: days(3) }, discounted).baseRentalCents;
    expect(after - before).toBe(6_000);
  });

  it("charges rent on a long hire at the discounted daily rate", () =>
    expect(rentOwedThrough({ pickupAt, chargedThroughAt: days(2), throughAt: days(4), baseRentalCents: 12_000 }, withDailyRate(rates, 6_000))).toBe(12_000));

  it("moves rent on a long hire onto the weekly rate when that beats discounted days", () =>
    expect(rentOwedThrough({ pickupAt, chargedThroughAt: days(6), throughAt: days(8), baseRentalCents: 42_000 }, withDailyRate(rates, 7_000))).toBe(10_000));
});
