/**
 * The day navigator's accessible form, in two parts placed where they belong:
 * the date stepper beside the day's title, and worst day / best day / random
 * beside the ribbon, whose metric they share. All native controls, operable
 * without a pointer. They are load-bearing: the ribbon is aria-hidden because
 * these duplicate its picker function (ADR-0009). Removing them obliges
 * making the ribbon a real slider.
 *
 * Worst and best are scoped to the Day view's metric and read the headline
 * model's published per-day figures; nothing here computes a metric. For every
 * metric on the page a larger figure is a worse day.
 */
import { DateInput } from "./DateInput.tsx";
import { addDays, inRecord } from "./record.ts";
import type { DailyMetric, Dashboard, DeliveryDate } from "./types.ts";

interface StepperProps {
  record: Dashboard["record"];
  day: DeliveryDate;
  onPick: (day: DeliveryDate) => void;
}

export function DateStepper({ record, day, onPick }: StepperProps) {
  return (
    <div className="stepper" role="group" aria-label="Delivery day">
      <button
        type="button"
        aria-label="Previous delivery day"
        disabled={day <= record.first}
        onClick={() => onPick(addDays(day, -1))}
      >
        <Chevron direction="left" />
      </button>
      <DateInput
        label="Delivery day"
        value={day}
        min={record.first}
        max={record.last}
        onChange={(value) => {
          if (inRecord(record, value)) onPick(value);
        }}
      />
      <button
        type="button"
        aria-label="Next delivery day"
        disabled={day >= record.last}
        onClick={() => onPick(addDays(day, 1))}
      >
        <Chevron direction="right" />
      </button>
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d={direction === "left" ? "M8.5 3 4.5 7l4 4" : "M5.5 3l4 4-4 4"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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

interface JumpProps {
  daily: DailyMetric;
  onPick: (day: DeliveryDate) => void;
}

export function DayJumps({ daily, onPick }: JumpProps) {
  const worst = extreme(daily, (a, b) => a > b);
  const best = extreme(daily, (a, b) => a < b);
  const days = daily.deliveryDates;

  return (
    <div className="jumps" role="group" aria-label="Jump to a day">
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
  );
}
