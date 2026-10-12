/**
 * The accuracy table: every model against four metrics over the scoreboard's
 * scope, the whole record or the last 30 days (ADR-0017). A semantic table,
 * so the product's central claim reaches a screen-reader user without any
 * chart being read aloud (ADR-0009). The naïve sits in it as its own row at
 * exactly rMAE 1.000, which is what teaches a reader what the ratio means;
 * rMAE renders bare. The lowest figure in each column is set in bold.
 */
import type { Metric, ModelMetrics, Scope } from "./types.ts";

import { LineKey } from "./Legend.tsx";
import {
  formatMetric,
  METRIC_PRESENTATION,
  METRICS,
  MODEL_LABELS,
  SCOPE_LABELS,
} from "./presentation.ts";

function lowest(rows: ModelMetrics[], metric: Metric): number | undefined {
  const values = rows.flatMap((r) => (r[metric] === null ? [] : [r[metric]]));
  return values.length ? Math.min(...values) : undefined;
}

export function AccuracyTable({
  rows,
  scope,
}: {
  rows: ModelMetrics[];
  scope: Scope;
}) {
  const best = Object.fromEntries(METRICS.map((m) => [m, lowest(rows, m)]));
  return (
    <table className="accuracy">
      <caption className="sr-only">Accuracy · {SCOPE_LABELS[scope]}</caption>
      <thead>
        <tr>
          <th scope="col">Model</th>
          {METRICS.map((m) => (
            <th key={m} scope="col">
              {METRIC_PRESENTATION[m].label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.model}>
            <th scope="row">
              <LineKey series={row.model} />
              {MODEL_LABELS[row.model]}
            </th>
            {METRICS.map((m) => (
              <td
                key={m}
                className={
                  row[m] !== null && row[m] === best[m] ? "best" : undefined
                }
              >
                {formatMetric(m, row[m])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
