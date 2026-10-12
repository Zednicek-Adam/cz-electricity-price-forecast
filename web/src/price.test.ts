import { describe, expect, test } from "vitest";
import { DASHBOARD } from "./fixture.ts";
import {
  distribution,
  priceDay,
  priceOverTime,
  priceProfile,
} from "./price.ts";

describe("price distribution", () => {
  test("computes exact quartiles and extremes", () => {
    const dist = distribution([10, 20, 30, 40, 50, 60, 70]);
    expect(dist).not.toBeNull();
    expect(dist?.min).toBe(10);
    expect(dist?.max).toBe(70);
    expect(dist?.median).toBe(40);
    expect(dist?.mean).toBe(40);
    expect(dist?.q25).toBe(25);
    expect(dist?.q75).toBe(55);
    expect(dist?.count).toBe(7);
  });

  test("handles single element", () => {
    const dist = distribution([42]);
    expect(dist?.min).toBe(42);
    expect(dist?.max).toBe(42);
    expect(dist?.median).toBe(42);
    expect(dist?.mean).toBe(42);
  });

  test("returns null for empty array", () => {
    expect(distribution([])).toBeNull();
  });
});

describe("priceProfile", () => {
  test("period profile has 24 buckets", () => {
    const profile = priceProfile(DASHBOARD, "period", "whole");
    expect(profile.by).toBe("period");
    expect(profile.buckets).toHaveLength(24);
    // Period 14 in fixture has negative price on last day
    const period14 = profile.buckets[13];
    expect(period14).not.toBeNull();
    expect(period14?.min).toBe(-138.75);
  });

  test("weekday profile has 7 buckets", () => {
    const profile = priceProfile(DASHBOARD, "weekday", "week");
    expect(profile.by).toBe("weekday");
    expect(profile.buckets).toHaveLength(7);
  });
});

describe("priceDay", () => {
  test("extracts observed prices for the day", () => {
    const day = priceDay(DASHBOARD, "2024-12-31");
    expect(day.observed).toHaveLength(24);
    expect(day.distribution?.min).toBe(-138.75);
  });
});

describe("priceOverTime", () => {
  test("generates running and trailing price series", () => {
    const running = priceOverTime(DASHBOARD, "whole");
    expect(running.kind).toBe("running");
    expect(running.deliveryDates).toEqual(DASHBOARD.running.dates);
  });
});
