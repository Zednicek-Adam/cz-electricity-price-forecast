/**
 * The day navigator's accessible form: a date stepper and worst day / best
 * day / random, all native controls, operable without a pointer. They are
 * load-bearing: the ribbon is aria-hidden because these duplicate its picker
 * function (ADR-0009). Removing them obliges making the ribbon a real slider.
 *
 * Worst and best are scoped to the selected metric and read the headline
 * model's published per-day figures; nothing here computes a metric. For every
 * metric on the page a larger figure is a worse day.
 */
import type { DailyMetricResponse, DeliveryDate } from "@cz-epf/api";

import { addDays, FIRST_DAY, inRecord, LAST_DAY } from "./record.ts";

interface Props {
  day: DeliveryDate;
  daily: DailyMetricResponse | null;
  onPick: (day: DeliveryDate) => void;
}

function extreme(
  daily: DailyMetricResponse,
  better: (a: number, b: number) => boolean,
): DeliveryDate | undefined {
  let found: number | undefined;
  daily.values.forEach((value, i) => {
    if (found === undefined || better(value, daily.values[found] as number)) {
      found = i;
    }
  });
  return found === undefined ? undefined : daily.deliveryDates[found];
}

export function DayNavigator({ day, daily, onPick }: Props) {
  const worst = daily && extreme(daily, (a, b) => a > b);
  const best = daily && extreme(daily, (a, b) => a < b);
  const days = daily?.deliveryDates ?? [];

  return (
    <div className="navigator">
      <div className="toggle-group" role="group" aria-label="Delivery day">
        <button
          type="button"
          aria-label="Previous delivery day"
          disabled={day <= FIRST_DAY}
          onClick={() => onPick(addDays(day, -1))}
        >
          ‹
        </button>
        <input
          type="date"
          aria-label="Delivery day"
          value={day}
          min={FIRST_DAY}
          max={LAST_DAY}
          onChange={(event) => {
            if (inRecord(event.target.value)) onPick(event.target.value);
          }}
        />
        <button
          type="button"
          aria-label="Next delivery day"
          disabled={day >= LAST_DAY}
          onClick={() => onPick(addDays(day, 1))}
        >
          ›
        </button>
      </div>
      <div className="toggle-group">
        <button
          type="button"
          disabled={!worst}
          onClick={() => worst && onPick(worst)}
        >
          Worst day
        </button>
        <button
          type="button"
          disabled={!best}
          onClick={() => best && onPick(best)}
        >
          Best day
        </button>
        <button
          type="button"
          disabled={days.length === 0}
          onClick={() => {
            const draw = Math.random();
            const pick = days[Math.floor(draw * days.length)];
            if (pick) onPick(pick);
          }}
        >
          Random
        </button>
      </div>
    </div>
  );
}
