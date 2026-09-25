/**
 * The numbers beneath the title: every model's figure in the selected metric.
 * In the Day view they are the selected delivery day's, as published.
 */
import type { Metric, ModelMetrics } from "@cz-epf/api";

import {
  formatMetric,
  METRIC_PRESENTATION,
  MODEL_LABELS,
  SERIES_COLOURS,
} from "./presentation.ts";

interface Props {
  metric: Metric;
  figures: ModelMetrics[];
}

export function HeadlineNumbers({ metric, figures }: Props) {
  const { label, unit } = METRIC_PRESENTATION[metric];
  return (
    <dl className="headline-numbers">
      {figures.map((figure) => (
        <div key={figure.model}>
          <dt>
            <span
              className="swatch"
              style={{ background: SERIES_COLOURS[figure.model] }}
            />
            {MODEL_LABELS[figure.model]} {label}
          </dt>
          <dd>
            {formatMetric(metric, figure[metric])}
            {unit && <span className="unit"> {unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
