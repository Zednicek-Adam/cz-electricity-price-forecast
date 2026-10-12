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
import { addDays, inRecord } from "./record.ts";
import type { DailyMetric, Dashboard, DeliveryDate } from "./types.ts";

interface Props {
  record: Dashboard["record"];
  day: DeliveryDate;
  daily: DailyMetric;
  onPick: (day: DeliveryDate) => void;
}

function extreme(
  daily: DailyMetric,
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

export function DayNavigator({ record, day, daily, onPick }: Props) {
  const worst = extreme(daily, (a, b) => a > b);
  const best = extreme(daily, (a, b) => a < b);
  const days = daily.deliveryDates;

  return (
    <div className="navigator">
      <div className="toggle-group" role="group" aria-label="Delivery day">
        <button
          type="button"
          aria-label="Previous delivery day"
          disabled={day <= record.first}
          onClick={() => onPick(addDays(day, -1))}
        >
          ‹
        </button>
        <input
          type="date"
          aria-label="Delivery day"
          value={day}
          min={record.first}
          max={record.last}
          onChange={(event) => {
            if (inRecord(record, event.target.value)) {
              onPick(event.target.value);
            }
          }}
        />
        <button
          type="button"
          aria-label="Next delivery day"
          disabled={day >= record.last}
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
