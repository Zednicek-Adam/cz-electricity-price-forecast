/**
 * The metric selector: MAE, RMSE, SMAPE or rMAE. There are two on the page,
 * one per thing a metric can drive, each placed beside what it changes
 * (ADR-0017): in the Day view it sits in the day's accuracy panel and rescores
 * the day, the ribbon and the day navigator, leaving the price chart alone; in
 * the Over time and 30-day views it sits in the chart's own bar and redraws
 * the chart.
 */
import type { Metric } from "./types.ts";

import { METRIC_PRESENTATION, METRICS } from "./presentation.ts";
import { Segmented } from "./Segmented.tsx";

interface Props {
  metric: Metric;
  onChange: (metric: Metric) => void;
  size?: "regular" | "small";
}

export function MetricSelector({ metric, onChange, size }: Props) {
  return (
    <Segmented
      label="Metric"
      options={METRICS}
      value={metric}
      onChange={onChange}
      name={(m) => METRIC_PRESENTATION[m].label}
      size={size}
    />
  );
}
