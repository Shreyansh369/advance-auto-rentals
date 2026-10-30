"use client";

import {
  discountedDailyCents,
  quoteRental,
  withDailyRate,
} from "@/packages/domain/src/pricing";

import type { VehicleRates } from "@/packages/domain/src/types";

import { formatMoney } from "@/lib/presentation";

/*
 * A discount on the daily rate, agreed at the start of a hire:
 * on the New booking tab or at checkout, never at the end.
 * It opens in dollars off the daily rate; a switch turns it
 * into a percentage of it. The reason is always required.
 */
export type DailyRateDiscountDraft = {
  type: "amount" | "percent";
  /* As typed: dollars, or a percentage. */
  value: string;
  reason: string;
};

export const EMPTY_DAILY_RATE_DISCOUNT: DailyRateDiscountDraft =
  {
    type: "amount",
    value: "",
    reason: "",
  };

/*
 * What is sent to the data layer: whole cents for a dollar
 * discount, the percentage as typed for a percentage, or null
 * when nothing was entered.
 */
export function dailyRateDiscountPayload(
  draft: DailyRateDiscountDraft,
): {
  type: "amount" | "percent";
  value: number;
  reason: string;
} | null {
  const raw = draft.value.trim();

  if (!raw) {
    return null;
  }

  const number = Number(raw);

  return {
    type: draft.type,
    value:
      draft.type === "amount"
        ? Math.round(number * 100)
        : number,
    reason: draft.reason.trim(),
  };
}

/*
 * The discounted daily rate and what the hire comes to at it,
 * or why the discount cannot be taken. Rates are the booking's
 * own; weekly and monthly stay as they are.
 */
export function previewDailyRateDiscount(
  draft: DailyRateDiscountDraft,
  rates: VehicleRates | null,
  period: {
    pickupAt: string;
    expectedReturnAt: string;
  } | null,
): {
  discountedDailyCents: number | null;
  fullTotalCents: number | null;
  discountedTotalCents: number | null;
  error: string | null;
} {
  const payload = dailyRateDiscountPayload(draft);

  const quote = (
    quoteRates: VehicleRates,
  ): number | null => {
    if (!period) {
      return null;
    }

    try {
      return quoteRental(period, quoteRates)
        .baseRentalCents;
    } catch {
      return null;
    }
  };

  const fullTotalCents = rates
    ? quote(rates)
    : null;

  if (!payload || !rates) {
    return {
      discountedDailyCents: null,
      fullTotalCents,
      discountedTotalCents: null,
      error: null,
    };
  }

  try {
    const discounted = discountedDailyCents(
      Number(rates.dailyCents ?? 0),
      payload,
    );

    return {
      discountedDailyCents: discounted,
      fullTotalCents,
      discountedTotalCents: quote(
        withDailyRate(rates, discounted),
      ),
      error: null,
    };
  } catch (cause) {
    return {
      discountedDailyCents: null,
      fullTotalCents,
      discountedTotalCents: null,
      error:
        cause instanceof Error
          ? `${cause.message}.`
          : "The discount cannot be applied.",
    };
  }
}

export function DailyRateDiscountField({
  idPrefix,
  draft,
  onChange,
  rates,
  period,
  isAdmin,
  disabled = false,
}: {
  idPrefix: string;
  draft: DailyRateDiscountDraft;
  onChange: (draft: DailyRateDiscountDraft) => void;
  rates: VehicleRates | null;
  period: {
    pickupAt: string;
    expectedReturnAt: string;
  } | null;
  isAdmin: boolean;
  disabled?: boolean;
}) {
  const preview = previewDailyRateDiscount(
    draft,
    rates,
    period,
  );

  const entered = draft.value.trim() !== "";

  const percent = draft.type === "percent";

  return (
    <fieldset className="field full checkout-block">
      <legend>
        Discount on the daily rate (optional)
      </legend>

      <p className="form-help">
        {isAdmin
          ? "Applies straight away: the hire is priced at the discounted daily rate."
          : "Sent to an administrator to approve. Until it is approved the hire is charged the full daily rate."}{" "}
        Weekly and monthly rates are unchanged.
      </p>

      <div className="checkout-charges">
        <div className="field">
          <label htmlFor={`${idPrefix}-value`}>
            {percent
              ? "% off the daily rate"
              : "$ off the daily rate"}
          </label>

          <input
            id={`${idPrefix}-value`}
            type="number"
            min="0.01"
            max={
              percent
                ? 99.99
                : rates?.dailyCents
                  ? (
                      (rates.dailyCents - 1) /
                      100
                    ).toFixed(2)
                  : undefined
            }
            step="0.01"
            inputMode="decimal"
            disabled={disabled}
            value={draft.value}
            onChange={(event) =>
              onChange({
                ...draft,
                value: event.target.value,
              })
            }
          />

          <label className="checkbox-row">
            <input
              type="checkbox"
              role="switch"
              aria-checked={percent}
              checked={percent}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...draft,
                  type: event.target.checked
                    ? "percent"
                    : "amount",
                  value: "",
                })
              }
            />
            Enter as a percentage
          </label>
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-reason`}>
            Reason
            {entered ? " (required)" : ""}
          </label>

          <input
            id={`${idPrefix}-reason`}
            maxLength={500}
            required={entered}
            disabled={disabled}
            placeholder="e.g. Returning customer"
            value={draft.reason}
            onChange={(event) =>
              onChange({
                ...draft,
                reason: event.target.value,
              })
            }
          />
        </div>
      </div>

      {entered && preview.error && (
        <p
          className="form-help"
          role="alert"
        >
          {preview.error}
        </p>
      )}

      {rates?.dailyCents != null && (
        <div className="payment-due">
          <dl>
            <div>
              <dt>Daily rate</dt>
              <dd>
                {formatMoney(rates.dailyCents)}
              </dd>
            </div>

            {preview.discountedDailyCents !==
              null && (
              <>
                <div>
                  <dt>Discount</dt>
                  <dd>
                    {percent
                      ? `${draft.value.trim()}%`
                      : formatMoney(
                          rates.dailyCents -
                            preview.discountedDailyCents,
                        )}{" "}
                    a day
                  </dd>
                </div>

                <div>
                  <dt>Discounted daily rate</dt>
                  <dd>
                    {formatMoney(
                      preview.discountedDailyCents,
                    )}
                  </dd>
                </div>
              </>
            )}

            {preview.fullTotalCents !== null && (
              <div>
                <dt>Rental total at full rate</dt>
                <dd>
                  {formatMoney(
                    preview.fullTotalCents,
                  )}
                </dd>
              </div>
            )}

            {preview.discountedTotalCents !==
              null && (
              <div className="payment-due-total">
                <dt>
                  Rental total at the discounted
                  rate
                  {isAdmin
                    ? ""
                    : " (once approved)"}
                </dt>
                <dd>
                  {formatMoney(
                    preview.discountedTotalCents,
                  )}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </fieldset>
  );
}
