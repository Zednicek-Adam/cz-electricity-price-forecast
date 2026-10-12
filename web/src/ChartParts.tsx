/**
 * The chrome every chart on the page shares, so they read as one system:
 * hairline gridlines instead of axis boxes, a ringed dot and an ink label at
 * each line's end, and one tooltip. The data is the only loud thing; the
 * chrome stays in the recessive greys (ADR-0009 still holds: every pointer
 * event belongs to the chart that draws it).
 */
import type { ModelSlug } from "./types.ts";

import { LineKey } from "./Legend.tsx";
import { SERIES_COLOURS } from "./presentation.ts";

type SeriesKey = ModelSlug | "observed";

/** Tick labels: muted ink, small, never the series colour. */
export const TICK_LABEL = {
  fill: "var(--muted)",
  fontSize: 11,
  fontFamily: "inherit",
} as const;

interface GridProps {
  ticks: number[];
  y: (value: number) => number;
  left: number;
  right: number;
}

/** Horizontal hairlines at the y ticks. */
export function YGrid({ ticks, y, left, right }: GridProps) {
  return (
    <g className="grid">
      {ticks.map((tick) => (
        <line
          key={tick}
          x1={left}
          x2={right}
          y1={y(tick)}
          y2={y(tick)}
          stroke="var(--grid)"
        />
      ))}
    </g>
  );
}

interface EndProps {
  series: SeriesKey;
  label: string;
  x: number;
  y: number;
  /** Where the label sits, already spread apart from its neighbours. */
  labelY: number;
}

/** A line's end: a dot ringed in the surface colour, and its name in ink. */
export function EndMarker({ series, label, x, y, labelY }: EndProps) {
  return (
    <>
      <circle
        cx={x}
        cy={y}
        r={3.5}
        fill={SERIES_COLOURS[series]}
        stroke="var(--surface)"
        strokeWidth={2}
      />
      <text
        x={x + 10}
        y={labelY}
        fill="var(--ink-2)"
        fontSize={11.5}
        fontWeight={600}
      >
        {label}
      </text>
    </>
  );
}

export interface TooltipRow {
  series: SeriesKey;
  label: string;
  value: string;
}

interface TooltipProps {
  title: string;
  rows: TooltipRow[];
  /** The crosshair's position as a fraction of the chart's width. */
  at: number;
}

/** One readout for every series at the crosshair. It flips to the left of
 * the crosshair past the middle, so it never runs off the chart's edge. */
export function Tooltip({ title, rows, at }: TooltipProps) {
  return (
    <div
      aria-hidden="true"
      className={at > 0.6 ? "tooltip tooltip-left" : "tooltip"}
      style={{ left: `${at * 100}%` }}
    >
      <div className="tooltip-title">{title}</div>
      {rows.map((row) => (
        <div key={row.series} className="tooltip-row">
          <LineKey series={row.series} />
          <span>{row.label}</span>
          <span className="figure">{row.value}</span>
        </div>
      ))}
    </div>
  );
}
