import type { Cents } from "./contracts";

// All money is integer cents. The only division in the engine is here.

/**
 * BUSINESS DECISION, flagged for the accountant: exact half cents round up,
 * per line. Totals are the sum of the rounded lines, so they always agree.
 * `divideRounded` is the single place this rule is applied.
 */
export const ROUNDING_MODE = "half_up" as const;

const BASIS_POINTS = 10_000;

export function assertCents(value: number, name = "amount"): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a whole, non-negative number`);
  }
}

function divideRounded(numerator: number, denominator: number): number {
  assertCents(numerator, "numerator");
  const remainder = numerator % denominator;
  const quotient = (numerator - remainder) / denominator;
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
}

export function basisPointsOf(cents: Cents, basisPoints: number): Cents {
  return divideRounded(cents * basisPoints, BASIS_POINTS);
}

/** Percentages are honoured to two decimals, e.g. 33.33. */
export function percentOf(cents: Cents, percent: number): Cents {
  return basisPointsOf(cents, Math.round(percent * 100));
}

export function sumCents(amounts: Cents[]): Cents {
  return amounts.reduce((total, amount) => total + amount, 0);
}
