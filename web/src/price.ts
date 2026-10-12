/**
 * Pure functions that select and aggregate electricity prices from `Dashboard`.
 * Computes distributions (min, q25, median, mean, q75, max) for profile cuts
 * and running / trailing series for the Over time cut.
 */
import type { Dashboard, DeliveryDate, History, Profile } from "./types.ts";

export interface PriceDistribution {
  min: number;
  q25: number;
  median: number;
  mean: number;
  q75: number;
  max: number;
  count: number;
}

export interface PriceProfile {
  by: Profile;
  scope: History;
  buckets: (PriceDistribution | null)[];
  overall: PriceDistribution | null;
}

export interface PriceOverTime {
  kind: "running" | "trailing";
  days: number | null;
  deliveryDates: DeliveryDate[];
  /** Trailing/running mean price aligned with deliveryDates (null before whole span fits) */
  values: (number | null)[];
  /** Daily mean price on each delivery date */
  dailyMeans: (number | null)[];
  /** Overall distribution across the scope */
  overall: PriceDistribution | null;
}

export interface PriceDay {
  deliveryDate: DeliveryDate;
  observed: number[] | null;
  distribution: PriceDistribution | null;
}

/** Compute distribution statistics (min, quartiles, median, mean, max) for a non-empty array of numbers. */
export function distribution(values: number[]): PriceDistribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;

  function quantile(q: number): number {
    const pos = q * (n - 1);
    const low = Math.floor(pos);
    const high = Math.ceil(pos);
    const weight = pos - low;
    return (
      (sorted[low] as number) * (1 - weight) + (sorted[high] as number) * weight
    );
  }

  return {
    min: sorted[0] as number,
    q25: quantile(0.25),
    median: quantile(0.5),
    mean,
    q75: quantile(0.75),
    max: sorted[n - 1] as number,
    count: n,
  };
}

/** The scored delivery dates that fall within a history scope. */
export function scopeDates(data: Dashboard, scope: History): DeliveryDate[] {
  const scored = data.running.dates.filter(
    (d) =>
      data.days[d]?.observed !== null && data.days[d]?.observed !== undefined,
  );
  if (scored.length === 0) {
    // Fallback for test fixtures where running.dates differ from days keys
    const dayKeys = Object.keys(data.days)
      .filter(
        (d) =>
          data.days[d]?.observed !== null &&
          data.days[d]?.observed !== undefined,
      )
      .sort();
    if (scope === "whole") return dayKeys;
    const count = scope === "week" ? data.week.days : data.window.days;
    return dayKeys.slice(-count);
  }

  if (scope === "whole") return scored;
  const span = data[scope];
  const matched = scored.filter((d) => d >= span.first && d <= span.last);
  if (matched.length > 0) return matched;
  return scored.slice(-span.days);
}

/** Hourly or weekday electricity price distribution profile over a history scope. */
export function priceProfile(
  data: Dashboard,
  by: Profile,
  scope: History,
): PriceProfile {
  const dates = scopeDates(data, scope);
  const isPeriod = by === "period";
  const count = isPeriod ? 24 : 7;
  const bucketValues: number[][] = Array.from({ length: count }, () => []);
  const allValues: number[] = [];

  for (const date of dates) {
    const observed = data.days[date]?.observed;
    if (!observed) continue;

    if (isPeriod) {
      for (let p = 0; p < 24; p++) {
        const val = observed[p];
        if (val !== undefined) {
          bucketValues[p]?.push(val);
          allValues.push(val);
        }
      }
    } else {
      // Weekday: 0 = Monday, 6 = Sunday
      const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
      for (let p = 0; p < observed.length; p++) {
        const val = observed[p];
        if (val !== undefined) {
          bucketValues[weekday]?.push(val);
          allValues.push(val);
        }
      }
    }
  }

  const buckets = bucketValues.map((vals) => distribution(vals));
  const overall = distribution(allValues);

  return {
    by,
    scope,
    buckets,
    overall,
  };
}

/** Electricity price series over time: running or trailing mean aligned with running.dates. */
export function priceOverTime(data: Dashboard, scope: History): PriceOverTime {
  const running = scope === "whole";
  const dates = data.running.dates;
  const dailyMeans: (number | null)[] = [];
  const allHourlyPrices: number[] = [];

  for (const date of dates) {
    const observed = data.days[date]?.observed;
    if (observed && observed.length > 0) {
      const sum = observed.reduce((a, b) => a + b, 0);
      dailyMeans.push(sum / observed.length);
      for (const p of observed) allHourlyPrices.push(p);
    } else {
      dailyMeans.push(null);
    }
  }

  const values: (number | null)[] = [];
  const spanDays = running ? null : data[scope].days;

  if (running) {
    let cumulativeSum = 0;
    let cumulativeCount = 0;
    for (let i = 0; i < dates.length; i++) {
      const observed = data.days[dates[i] as DeliveryDate]?.observed;
      if (observed) {
        for (const p of observed) {
          cumulativeSum += p;
          cumulativeCount++;
        }
      }
      values.push(cumulativeCount > 0 ? cumulativeSum / cumulativeCount : null);
    }
  } else {
    const windowSize = spanDays as number;
    for (let i = 0; i < dates.length; i++) {
      if (i < windowSize - 1) {
        values.push(null);
      } else {
        let winSum = 0;
        let winCount = 0;
        for (let j = i - windowSize + 1; j <= i; j++) {
          const obs = data.days[dates[j] as DeliveryDate]?.observed;
          if (obs) {
            for (const p of obs) {
              winSum += p;
              winCount++;
            }
          }
        }
        values.push(winCount > 0 ? winSum / winCount : null);
      }
    }
  }

  // Distribution over the chosen scope's dates
  const scopeDateSet = new Set(scopeDates(data, scope));
  const scopePrices: number[] = [];
  for (const date of scopeDateSet) {
    const obs = data.days[date]?.observed;
    if (obs) {
      for (const p of obs) scopePrices.push(p);
    }
  }

  return {
    kind: running ? "running" : "trailing",
    days: spanDays,
    deliveryDates: dates,
    values,
    dailyMeans,
    overall: distribution(
      scopePrices.length > 0 ? scopePrices : allHourlyPrices,
    ),
  };
}

/** One delivery day's electricity price observed values and distribution. */
export function priceDay(data: Dashboard, date: DeliveryDate): PriceDay {
  const day = data.days[date];
  const observed = day?.observed ?? null;
  return {
    deliveryDate: date,
    observed,
    distribution: observed ? distribution(observed) : null,
  };
}
