/**
 * The metric selector: one control choosing the metric for the whole page —
 * both views of the hero chart, the headline numbers and the day navigator.
 * There is no per-element metric choice (ADR-0007).
 */
import type { Metric } from "@cz-epf/api";

import { METRIC_PRESENTATION, METRICS } from "./presentation.ts";

interface Props {
  metric: Metric;
  onChange: (metric: Metric) => void;
}

export function MetricSelector({ metric, onChange }: Props) {
  return (
    <div role="group" aria-label="Metric" className="toggle-group">
      {METRICS.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={m === metric}
          onClick={() => onChange(m)}
        >
          {METRIC_PRESENTATION[m].label}
        </button>
      ))}
    </div>
  );
}
