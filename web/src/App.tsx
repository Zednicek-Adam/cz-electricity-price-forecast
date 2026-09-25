/**
 * The dashboard (ADR-0007): one hero chart with two views switched in place,
 * the headline numbers beneath the title, one metric selector governing the
 * page, the day navigator, then the accuracy table and the Diebold–Mariano
 * card.
 *
 * The page holds the state the controls share — the view, the metric, the
 * delivery day and the model the DM card is about — and each view fetches its
 * payload the first time it needs it. There is no prose: every date on screen
 * is in 2020–2024, and the record says what it is.
 */
import type {
  AccuracyResponse,
  DailyMetricResponse,
  DeliveryDate,
  DeliveryDayResponse,
  Metric,
  ModelSlug,
  RunningMetricResponse,
} from "@cz-epf/api";
import { useState } from "react";

import { AccuracyTable } from "./AccuracyTable.tsx";
import { useJson } from "./api.ts";
import { ComparisonCard } from "./ComparisonCard.tsx";
import { DayChart } from "./DayChart.tsx";
import { DayNavigator } from "./DayNavigator.tsx";
import { Footer } from "./Footer.tsx";
import { HeadlineNumbers } from "./HeadlineNumbers.tsx";
import { MetricSelector } from "./MetricSelector.tsx";
import { OverTimeChart } from "./OverTimeChart.tsx";
import { METRIC_PRESENTATION } from "./presentation.ts";
import { FIRST_DAY, LAST_DAY } from "./record.ts";
import { Ribbon } from "./Ribbon.tsx";

/** The day the Day view opens on: the last day of the fixed backtest window
 * (ADR-0002), rather than a day picked for how it looks. */
export const OPENING_DAY: DeliveryDate = LAST_DAY;

type View = "day" | "overTime";

export function App() {
  const [view, setView] = useState<View>("day");
  const [metric, setMetric] = useState<Metric>("mae");
  const [deliveryDate, setDeliveryDate] = useState<DeliveryDate>(OPENING_DAY);
  const [dmModel, setDmModel] = useState<ModelSlug>("chronos2");

  const onDay = view === "day";
  const day = useJson<DeliveryDayResponse>(
    onDay ? `/api/days/${deliveryDate}` : null,
  );
  const daily = useJson<DailyMetricResponse>(
    onDay ? `/api/daily/${metric}` : null,
  );
  const running = useJson<RunningMetricResponse>(
    onDay ? null : `/api/running/${metric}`,
  );
  const accuracy = useJson<AccuracyResponse>("/api/accuracy");
  const models =
    accuracy.state === "ready" ? accuracy.data.rows.map((r) => r.model) : [];

  // The same models, reframed: the selected day in Day view, the whole record
  // in Over time view.
  const headline = onDay
    ? day.state === "ready" && day.data.metrics
    : accuracy.state === "ready" && accuracy.data.rows;

  return (
    <>
      <header>
        <h1>CZ day-ahead price forecast</h1>
        <p className="caption">
          {FIRST_DAY} – {LAST_DAY} · EUR/MWh
        </p>
      </header>
      <main>
        <section className="card hero" aria-label="Hero chart">
          <div className="hero-bar">
            <h2>
              {onDay
                ? deliveryDate
                : `${METRIC_PRESENTATION[metric].label} over time`}
            </h2>
            <div className="controls">
              <div className="toggle-group" role="group" aria-label="View">
                <button
                  type="button"
                  aria-pressed={onDay}
                  onClick={() => setView("day")}
                >
                  Day
                </button>
                <button
                  type="button"
                  aria-pressed={!onDay}
                  onClick={() => setView("overTime")}
                >
                  Over time
                </button>
              </div>
              <MetricSelector metric={metric} onChange={setMetric} />
            </div>
          </div>
          {headline && <HeadlineNumbers metric={metric} figures={headline} />}
          {onDay && day.state === "ready" && <DayChart day={day.data} />}
          {onDay && daily.state === "ready" && daily.data.values.length > 0 && (
            <Ribbon
              daily={daily.data}
              selected={deliveryDate}
              onPick={setDeliveryDate}
            />
          )}
          {onDay && (
            <DayNavigator
              day={deliveryDate}
              daily={daily.state === "ready" ? daily.data : null}
              onPick={setDeliveryDate}
            />
          )}
          {!onDay && running.state === "ready" && (
            <OverTimeChart metric={metric} running={running.data} />
          )}
        </section>
        {accuracy.state === "ready" && (
          <section className="card" aria-label="Accuracy">
            <AccuracyTable accuracy={accuracy.data} />
          </section>
        )}
        {models.length > 1 && (
          <section className="card" aria-label="Diebold–Mariano">
            <ComparisonCard
              model={
                models.includes(dmModel) ? dmModel : (models[0] as ModelSlug)
              }
              models={models}
              onModel={setDmModel}
            />
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}
