/**
 * The backtest window: 2020-01-01 to 2024-12-31, 1,827 delivery days, fixed
 * (ADR-0002). The start is forced by AR-168's 730-day history against a record
 * opening 2018-01-01.
 */
import type { DeliveryDate } from "@cz-epf/api";

export const FIRST_DAY: DeliveryDate = "2020-01-01";
export const LAST_DAY: DeliveryDate = "2024-12-31";

/** The delivery day `n` calendar days from `day`. Calendar arithmetic on the
 * date alone, so a daylight-saving change cannot skip or repeat a day. */
export function addDays(day: DeliveryDate, n: number): DeliveryDate {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

export function inRecord(day: DeliveryDate): boolean {
  return day >= FIRST_DAY && day <= LAST_DAY;
}

/** The positions in `days` where a calendar year begins, with the year. */
export function yearStarts(
  days: DeliveryDate[],
): { index: number; year: string }[] {
  return days.flatMap((day, index) =>
    day.endsWith("-01-01") ? [{ index, year: day.slice(0, 4) }] : [],
  );
}
