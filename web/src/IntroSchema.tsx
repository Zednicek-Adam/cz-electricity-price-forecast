/**
 * The introduction's schema (ADR-0020): how a day-ahead price forecast works,
 * as four drawings joined by arrows, each with a title and no more. The one
 * idea is the gap after "now": the known prices stop there and nobody knows
 * the next day. So the first and third drawings are one frame, before and
 * after. The first leaves the next day empty; the models sit between; the
 * third fills the same space with the forecast, the known prices greyed so
 * the eye lands on what is new. The fourth zooms into that next day once its
 * real prices are in: 24 forecasts, 24 real prices, and the error between
 * each pair.
 *
 * The prices are a sketch, not the record: one made-up series. The drawings
 * are hidden from assistive technology, and one sentence says the same thing
 * in words.
 */
import type { ReactNode } from "react";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";

import { LineKey } from "./Legend.tsx";
import { MODEL_LABELS } from "./presentation.ts";
import type { ModelSlug } from "./types.ts";

/** A wave of period `hours`, shifted by `phase` hours. */
function wave(t: number, hours: number, phase: number): number {
  return Math.sin((2 * Math.PI * (t - phase)) / hours);
}

/** The price at hour `t`, as an illustration rather than a likeness, in no
 * unit: a daily cycle, a twice-daily bump and a slow drift over a few days,
 * so the days are alike but not the same. Hour 0 is "now"; negative hours
 * are the known ones before it. */
function price(t: number): number {
  return 60 + 12 * wave(t, 24, 8) + 5 * wave(t, 12, 2) + 4 * wave(t, 70, 10);
}

/** The forecast for the hours after "now": the same cycle, a little too
 * calm and a little late, as forecasts are. It starts at the last known
 * price and drifts onto its own course over the first hours. */
function forecastAt(t: number): number {
  const guess = 61 + 10 * wave(t, 24, 9) + 3.5 * wave(t, 12, 2.8);
  const start = 61 + 10 * wave(0, 24, 9) + 3.5 * wave(0, 12, 2.8);
  return guess + (price(0) - start) * Math.exp(-t / 5);
}

/** The next day's real price, once it is in: the known series carried on,
 * with a few bumps of its own that no pattern in the past foretold, as real
 * days have. */
function realAt(t: number): number {
  return price(t) + 7.5 * wave(t, 7, 1.5);
}

/** The last two days up to "now", at hour 0, and the day after it. */
const PAST = Array.from({ length: 49 }, (_, i) => i - 48);
const NEXT = Array.from({ length: 25 }, (_, i) => i);

/** Both drawings share one geometry, so the two days match exactly: the
 * width of an hour, the height, and the price scale. */
const HOUR = 3.3;
const HEIGHT = 140;
const PAD = { top: 8, right: 8, bottom: 8, left: 6 };
const ALL = [...PAST.map(price), ...NEXT.map(forecastAt)];
const Y = scaleLinear({
  domain: [Math.min(...ALL) - 3, Math.max(...ALL) + 3],
  range: [HEIGHT - PAD.bottom, PAD.top],
});
const x = (t: number) => PAD.left + HOUR * (t + 48);
const NOW = x(0);

const MODELS: readonly ModelSlug[] = ["chronos2", "ar168", "daylag"];

export function IntroSchema() {
  return (
    <div className="schema">
      <p className="sr-only">
        Diagram: the price is known up to now and the next day is not. The three
        models read the known prices and fill the next day with a forecast. When
        the real prices for that day are in, each hour's forecast is compared
        with its real price, and the gap between them is the error.
      </p>
      <Step number={1} title="Prices so far">
        <PriceSketch />
      </Step>
      <Arrow />
      <Step number={2} title="Models predict" className="schema-models">
        <ul>
          {MODELS.map((model) => (
            <li key={model}>
              <LineKey series={model} />
              {MODEL_LABELS[model]}
            </li>
          ))}
        </ul>
      </Step>
      <Arrow />
      <Step number={3} title="Forecast for the next day">
        <PriceSketch forecast />
      </Step>
      <Arrow />
      <Step number={4} title="Compared with the real price">
        <ScoredDay />
      </Step>
    </div>
  );
}

/** One drawing with its numbered title above it. */
function Step({
  number,
  title,
  className,
  children,
}: {
  number: number;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <figure className="schema-step">
      <figcaption>
        <span className="schema-number" aria-hidden="true">
          {number}
        </span>
        {title}
      </figcaption>
      <div
        className={className ? `schema-art ${className}` : "schema-art"}
        aria-hidden="true"
      >
        {children}
      </div>
    </figure>
  );
}

function Arrow() {
  return (
    <div className="schema-arrow" aria-hidden="true">
      <span>
        <svg width="14" height="14" viewBox="0 0 14 14">
          <path
            d="M2 7h9M7.5 3l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
}

/** The last two days of prices up to a dashed "now", then the next day
 * as a band. Without `forecast` the band is empty; with it, the band holds the
 * forecast in its blue, carried on from the last known price, and the known
 * prices step back to grey. */
function PriceSketch({ forecast = false }: { forecast?: boolean }) {
  const end = x(24);
  const width = end + PAD.right;
  const floor = HEIGHT - PAD.bottom;
  const past = forecast ? "var(--axis)" : "var(--series-observed)";

  return (
    <svg className="schema-chart" viewBox={`0 0 ${width} ${HEIGHT}`}>
      <rect
        x={NOW}
        y={PAD.top - 6}
        width={end - NOW}
        height={floor - PAD.top + 6}
        rx={6}
        fill={forecast ? "var(--schema-next)" : "var(--schema-empty)"}
      />
      <LinePath
        data={PAST}
        x={(t) => x(t)}
        y={(t) => Y(price(t))}
        stroke={past}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {forecast && (
        <LinePath
          data={NEXT}
          x={(t) => x(t)}
          y={(t) => Y(forecastAt(t))}
          stroke="var(--accent)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <line
        x1={NOW}
        x2={NOW}
        y1={PAD.top - 6}
        y2={floor}
        stroke="var(--ink-2)"
        strokeWidth={1.25}
        strokeDasharray="3 3"
      />
    </svg>
  );
}

/** The next day up close, once its real prices are in: for each of the 24
 * hours a forecast, a ring on step 3's blue line, and the real price, a
 * black dot, with the error a red segment between them. The real prices are
 * the known series carried on with bumps of their own, so the forecast,
 * a little too calm and a little late, misses them. Drawn on the blue of step 3's band, as
 * that band zoomed in, from the same dashed "now". */
function ScoredDay() {
  // Narrower hours and a taller frame than the other drawings: the errors
  // are vertical, so they get the room.
  const slot = 9;
  const width = 24 * slot + 12;
  const height = HEIGHT;
  const pad = { top: 8, bottom: 8, left: 6 };
  const sx = (h: number) => pad.left + slot * (h + 0.5);
  const hours = Array.from({ length: 24 }, (_, h) => h + 0.5);
  const values = hours.flatMap((t) => [forecastAt(t), realAt(t)]);
  const sy = scaleLinear({
    domain: [Math.min(...values) - 2, Math.max(...values) + 2],
    range: [height - pad.bottom, pad.top],
  });

  return (
    <svg className="schema-chart" viewBox={`0 0 ${width} ${height}`}>
      <rect
        x={1}
        y={pad.top - 6}
        width={width - 1}
        height={height - pad.top - pad.bottom + 6}
        rx={6}
        fill="var(--schema-next)"
      />
      <line
        x1={1}
        x2={1}
        y1={pad.top - 6}
        y2={height - pad.bottom}
        stroke="var(--ink-2)"
        strokeWidth={1.25}
        strokeDasharray="3 3"
      />
      {hours.map((t, h) => (
        <line
          key={h}
          x1={sx(h)}
          x2={sx(h)}
          y1={sy(forecastAt(t))}
          y2={sy(realAt(t))}
          stroke="var(--schema-error)"
          strokeWidth={3}
          strokeLinecap="round"
        />
      ))}
      <LinePath
        data={hours}
        x={(_, h) => sx(h)}
        y={(t) => sy(forecastAt(t))}
        stroke="var(--accent)"
        strokeWidth={1.5}
        strokeOpacity={0.5}
        strokeLinejoin="round"
      />
      {hours.map((t, h) => (
        <g key={h}>
          <circle
            cx={sx(h)}
            cy={sy(forecastAt(t))}
            r={2.75}
            fill="var(--surface)"
            stroke="var(--accent)"
            strokeWidth={1.5}
          />
          <circle
            cx={sx(h)}
            cy={sy(realAt(t))}
            r={2.75}
            fill="var(--series-observed)"
          />
        </g>
      ))}
    </svg>
  );
}
