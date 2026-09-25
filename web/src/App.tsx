/**
 * The dashboard (ADR-0007): one hero chart, the headline numbers beneath the
 * title, one metric selector governing the page, then the accuracy table.
 *
 * The page holds the state the controls share — the metric and the delivery
 * day — and fetches a view's payload once, when that payload is first needed.
 * Nothing polls and nothing refreshes (ADR-0010). There is no prose: every
 * date on screen is in 2020–2024, and the record says what it is.
 */
import type {
  AccuracyResponse,
  DeliveryDate,
  DeliveryDayResponse,
  Metric,
} from "@cz-epf/api";
import { useEffect, useState } from "react";

import { getJson } from "./api.ts";
import { DayChart } from "./DayChart.tsx";
import { Footer } from "./Footer.tsx";
import { HeadlineNumbers } from "./HeadlineNumbers.tsx";
import { MetricSelector } from "./MetricSelector.tsx";
import {
  formatMetric,
  METRIC_PRESENTATION,
  METRICS,
  MODEL_LABELS,
} from "./presentation.ts";

/** The day the Day view opens on: the last day of the fixed backtest window
 * (ADR-0002), rather than a day picked for how it looks. */
export const OPENING_DAY: DeliveryDate = "2024-12-31";

type Load<T> =
  { state: "loading" } | { state: "ready"; data: T } | { state: "failed" };

/** Fetch `path` once per distinct path; never again on its own. */
function useJson<T>(path: string): Load<T> {
  const [load, setLoad] = useState<{ path: string; load: Load<T> }>({
    path,
    load: { state: "loading" },
  });
  useEffect(() => {
    let current = true;
    getJson<T>(path)
      .then(
        (data) => current && setLoad({ path, load: { state: "ready", data } }),
      )
      .catch(() => current && setLoad({ path, load: { state: "failed" } }));
    return () => {
      current = false;
    };
  }, [path]);
  return load.path === path ? load.load : { state: "loading" };
}

export function App() {
  const [metric, setMetric] = useState<Metric>("mae");
  const deliveryDate = OPENING_DAY;
  const day = useJson<DeliveryDayResponse>(`/api/days/${deliveryDate}`);
  const accuracy = useJson<AccuracyResponse>("/api/accuracy");

  return (
    <>
      <header>
        <h1>CZ day-ahead price forecast</h1>
        <p className="caption">2020-01-01 – 2024-12-31 · EUR/MWh</p>
      </header>
      <main>
        <section className="card hero" aria-label="Hero chart">
          <div className="hero-bar">
            <h2>{deliveryDate}</h2>
            <MetricSelector metric={metric} onChange={setMetric} />
          </div>
          {day.state === "ready" && (
            <>
              <HeadlineNumbers metric={metric} figures={day.data.metrics} />
              <DayChart day={day.data} />
            </>
          )}
        </section>
        {accuracy.state === "ready" && (
          <section className="card" aria-label="Accuracy">
            <table>
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
                {accuracy.data.rows.map((row) => (
                  <tr key={row.model}>
                    <th scope="row">{MODEL_LABELS[row.model]}</th>
                    {METRICS.map((m) => (
                      <td key={m}>{formatMetric(m, row[m])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}
