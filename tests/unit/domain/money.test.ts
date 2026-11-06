import { describe, expect, it } from "vitest";
import {
  assertCents,
  basisPointsOf,
  percentOf,
  ROUNDING_MODE,
  sumCents,
} from "@/lib/domain";

describe("rounding", () => {
  it("is half up", () => {
    expect(ROUNDING_MODE).toBe("half_up");
    expect(basisPointsOf(5, 5000)).toBe(3);
    expect(basisPointsOf(1005, 3000)).toBe(302);
  });

  it("rounds below and above the half correctly", () => {
    expect(basisPointsOf(1001, 3000)).toBe(300);
    expect(basisPointsOf(1002, 3000)).toBe(301);
  });

  it("is exact where float arithmetic is not", () => {
    // 1.005 * 100 is 100.49999 in floats, which would round the wrong way.
    expect(basisPointsOf(10050, 100)).toBe(101);
    expect(percentOf(100000, 33.33)).toBe(33330);
    expect(percentOf(1999, 7)).toBe(140);
  });

  it("keeps two decimals of a percentage", () => {
    expect(percentOf(10000, 12.5)).toBe(1250);
    expect(percentOf(10000, 0.01)).toBe(1);
  });

  it("handles zero and whole amounts", () => {
    expect(basisPointsOf(0, 2400)).toBe(0);
    expect(basisPointsOf(12345, 10000)).toBe(12345);
    expect(basisPointsOf(12345, 0)).toBe(0);
  });

  it("stays exact on a very large stay", () => {
    expect(basisPointsOf(100_000_000_00, 2400)).toBe(2_400_000_000);
  });
});

describe("assertCents", () => {
  it.each([1.5, -1, NaN, Infinity, 2 ** 53])("refuses %s", (value) => {
    expect(() => assertCents(value)).toThrow(RangeError);
  });

  it("accepts zero", () => {
    expect(() => assertCents(0)).not.toThrow();
  });
});

describe("sumCents", () => {
  it("adds, and an empty list is zero", () => {
    expect(sumCents([100, -30, 5])).toBe(75);
    expect(sumCents([])).toBe(0);
  });
});
