/**
 * Series identity off the plot: a legend above every multi-series chart, and
 * the short line key it is made of, which the tooltips and the headline
 * numbers reuse. The key mirrors the mark — a stroke of the series' colour,
 * dashed for the naïve — and the text beside it stays in ink.
 */
import type { ModelSlug } from "./types.ts";

import { MODEL_LABELS, SERIES_COLOURS, SERIES_DASH } from "./presentation.ts";

type SeriesKey = ModelSlug | "observed";

export function seriesLabel(key: SeriesKey): string {
  return key === "observed" ? "Observed" : MODEL_LABELS[key];
}

export function LineKey({ series }: { series: SeriesKey }) {
  return (
    <svg className="line-key" width="18" height="8" aria-hidden="true">
      <line
        x1="1"
        x2="17"
        y1="4"
        y2="4"
        stroke={SERIES_COLOURS[series]}
        strokeWidth={series === "observed" ? 3 : 2.5}
        strokeDasharray={SERIES_DASH[series]}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Legend({ series }: { series: SeriesKey[] }) {
  return (
    <ul className="legend" aria-label="Legend">
      {series.map((key) => (
        <li key={key}>
          <LineKey series={key} />
          {seriesLabel(key)}
        </li>
      ))}
    </ul>
  );
}
