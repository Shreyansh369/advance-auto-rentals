import { describe, expect, it } from "vitest";
import {
  PAYMENT_METHODS,
  RENTAL_PAYMENT_METHOD_OPTIONS,
  paymentMethodLabel,
} from "../../lib/agreement";

describe("payment methods", () => {
  it("keeps Credit card on the agreement and adds Credit and ATH beside it", () => {
    const labels = Object.fromEntries(PAYMENT_METHODS.map((method) => [method.value, method.label]));
    expect(labels).toMatchObject({ cash: "Cash", check: "Check", credit: "Credit card", account_credit: "Credit", ath: "ATH" });
  });

  it("never reuses the credit-card value for Credit", () => {
    const values = PAYMENT_METHODS.map((method) => method.value);
    expect(new Set(values).size).toBe(values.length);
    expect(PAYMENT_METHODS.find((method) => method.value === "credit")?.label).toBe("Credit card");
  });

  it("offers both new methods on the till", () => {
    const values = RENTAL_PAYMENT_METHOD_OPTIONS.map((method) => method.value);
    expect(values).toEqual(expect.arrayContaining(["cash", "card", "bank_transfer", "other", "account_credit", "ath"]));
  });

  it("labels old and new stored payments", () => {
    expect(paymentMethodLabel("cash")).toBe("Cash");
    expect(paymentMethodLabel("card")).toBe("Card");
    expect(paymentMethodLabel("bank_transfer")).toBe("Bank transfer");
    expect(paymentMethodLabel("check")).toBe("Check");
    expect(paymentMethodLabel("account_credit")).toBe("Credit");
    expect(paymentMethodLabel("ath")).toBe("ATH");
  });
});
