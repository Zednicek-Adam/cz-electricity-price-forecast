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

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** A delivery day as a tick names it, "15 Mar", or its year on 1 January. */
function dayAndMonth(day: DeliveryDate): string {
  if (day.endsWith("-01-01")) return day.slice(0, 4);
  return `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
}

/**
 * The time axis's ticks over `days`, as fine as the span they cover allows:
 * years over more than three years; quarters, every other month or months
 * down to four months; the 1st and 15th down to a month; and evenly spaced
 * days below that, always with 1 January among them. A year's first tick is
 * named by its year.
 */
export function timeTicks(
  days: DeliveryDate[],
): { index: number; label: string }[] {
  const n = days.length;
  if (n > 3 * 366) {
    return yearStarts(days).map(({ index, year }) => ({ index, label: year }));
  }
  if (n > 120) {
    const every = n > 730 ? 3 : n > 365 ? 2 : 1;
    return days.flatMap((day, index) => {
      const month = Number(day.slice(5, 7));
      if (!day.endsWith("-01") || (month - 1) % every !== 0) return [];
      const label = month === 1 ? day.slice(0, 4) : MONTHS[month - 1];
      return [{ index, label: label ?? "" }];
    });
  }
  if (n > 31) {
    return days.flatMap((day, index) =>
      day.endsWith("-01") || day.endsWith("-15")
        ? [{ index, label: dayAndMonth(day) }]
        : [],
    );
  }
  const step = Math.max(1, Math.ceil(n / 8));
  const years = days.flatMap((day, index) =>
    day.endsWith("-01-01") ? [index] : [],
  );
  // A step tick too close to a year's would run into its label.
  const crowds = (index: number) =>
    years.some((y) => y !== index && Math.abs(y - index) < Math.max(2, step));
  return days.flatMap((day, index) =>
    years.includes(index) || (index % step === 0 && !crowds(index))
      ? [{ index, label: dayAndMonth(day) }]
      : [],
  );
}
