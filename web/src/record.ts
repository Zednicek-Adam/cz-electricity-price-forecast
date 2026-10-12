/**
 * Calendar helpers for the record, whose extent arrives in `dashboard.json`: it
 * opens 2020-01-01, forced by AR-168's 730-day history against prices from
 * 2018-01-01, and grows by a delivery day with each daily run (ADR-0016).
 */
import type { Dashboard, DeliveryDate } from "./types.ts";

type Record = Dashboard["record"];

/** The delivery day `n` calendar days from `day`. Calendar arithmetic on the
 * date alone, so a daylight-saving change cannot skip or repeat a day. */
export function addDays(day: DeliveryDate, n: number): DeliveryDate {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

export function inRecord(record: Record, day: DeliveryDate): boolean {
  return day >= record.first && day <= record.last;
}

/** Today's date in `Europe/Prague`, the market's calendar. */
export function todayInPrague(now: Date = new Date()): DeliveryDate {
  // en-CA formats a date as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(
    now,
  );
}

/**
 * Whether the daily run has stopped (ADR-0012). The pending forecast's price
 * publishes the day before its delivery day, and the run that follows replaces
 * it with the next one; a pending day that is today or earlier was never
 * replaced.
 */
export function isStale(record: Record, today: DeliveryDate): boolean {
  return record.pending !== null && record.pending <= today;
}

/** The positions in `days` where a calendar year begins, with the year. */
export function yearStarts(
  days: DeliveryDate[],
): { index: number; year: string }[] {
  return days.flatMap((day, index) =>
    day.endsWith("-01-01") ? [{ index, year: day.slice(0, 4) }] : [],
  );
}
