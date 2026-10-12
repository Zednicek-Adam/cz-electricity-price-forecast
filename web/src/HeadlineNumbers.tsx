/**
 * The headline numbers: every model's figure in the selected metric, one tile
 * each, over whichever scope the view reads — the selected delivery day, the
 * whole record, or the last 30 days. For every metric on the page a lower
 * figure is better, so the lowest tile is marked best; a tie marks none.
 */
import type { Metric, ModelMetrics } from "./types.ts";

import { LineKey } from "./Legend.tsx";
import {
  formatMetric,
  METRIC_PRESENTATION,
  MODEL_LABELS,
} from "./presentation.ts";

interface Props {
  metric: Metric;
  figures: ModelMetrics[];
}

function best(metric: Metric, figures: ModelMetrics[]): string | undefined {
  const shown = figures.flatMap((f) => {
    const value = f[metric];
    return value === null ? [] : [{ model: f.model, value }];
  });
  const lowest = Math.min(...shown.map((s) => s.value));
  const winners = shown.filter((s) => s.value === lowest);
  return winners.length === 1 ? winners[0]?.model : undefined;
}

export function HeadlineNumbers({ metric, figures }: Props) {
  const { unit } = METRIC_PRESENTATION[metric];
  const winner = best(metric, figures);
  return (
    <dl className="headline-numbers">
      {figures.map((figure) => (
        <div
          key={figure.model}
          className={figure.model === winner ? "tile tile-best" : "tile"}
        >
          <dt>
            <LineKey series={figure.model} />
            {MODEL_LABELS[figure.model]}
            {figure.model === winner && <span className="badge">Best</span>}
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
