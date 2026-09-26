/**
 * The accuracy table: every model against four metrics over the whole record
 * (ADR-0007). A semantic table, so the product's central claim reaches a
 * screen-reader user without any chart being read aloud (ADR-0009). The naïve
 * sits in it as its own row at exactly rMAE 1.000, which is what teaches a
 * reader what the ratio means; rMAE renders bare.
 */
import type { AccuracyResponse } from "@cz-epf/api";

import {
  formatMetric,
  METRIC_PRESENTATION,
  METRICS,
  MODEL_LABELS,
  SERIES_COLOURS,
} from "./presentation.ts";

export function AccuracyTable({ accuracy }: { accuracy: AccuracyResponse }) {
  return (
    <table>
      <caption className="caption">Accuracy · every replayed day</caption>
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
        {accuracy.rows.map((row) => (
          <tr key={row.model}>
            <th scope="row">
              <span
                className="swatch"
                style={{ background: SERIES_COLOURS[row.model] }}
              />
              {MODEL_LABELS[row.model]}
            </th>
            {METRICS.map((m) => (
              <td key={m}>{formatMetric(m, row[m])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
