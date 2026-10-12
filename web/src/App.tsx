/**
 * The dashboard (ADR-0007): one hero chart with two views switched in place,
 * the headline numbers beneath the title, one metric selector governing the
 * page, the day navigator, then the accuracy table and the Diebold–Mariano
 * card.
 *
 * The page holds the state the controls share — the view, the metric, the
 * delivery day and the model the DM card is about — and each view fetches its
 * payload the first time it needs it. There is no prose: the record says what
 * it is. The two exceptions are claims the record cannot make by itself: the
 * pending day has no price yet, and a daily run that has stopped (ADR-0012).
 */
import type {
  AccuracyResponse,
  DailyMetricResponse,
  DeliveryDate,
  DeliveryDayResponse,
  Metric,
  ModelSlug,
  RecordResponse,
  RunningMetricResponse,
} from "./types.ts";
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
import { isStale, todayInPrague } from "./record.ts";
import { Ribbon } from "./Ribbon.tsx";

type View = "day" | "overTime";

export function App() {
  const [view, setView] = useState<View>("day");
  const [metric, setMetric] = useState<Metric>("mae");
  const [picked, setPicked] = useState<DeliveryDate | null>(null);
  const [dmModel, setDmModel] = useState<ModelSlug>("chronos2");

  const record = useJson<RecordResponse>("/data/record.json");
  const extent = record.state === "ready" ? record.data : null;
  // The Day view opens on the record's last day, the pending forecast while
  // there is one, rather than on a day picked for how it looks.
  const deliveryDate = picked ?? extent?.last ?? null;

  const onDay = view === "day";
  const day = useJson<DeliveryDayResponse>(
    onDay && deliveryDate ? `/data/days/${deliveryDate}.json` : null,
  );
  const daily = useJson<DailyMetricResponse>(
    onDay ? `/data/daily/${metric}.json` : null,
  );
  const running = useJson<RunningMetricResponse>(
    onDay ? null : `/data/running/${metric}.json`,
  );
  const accuracy = useJson<AccuracyResponse>("/data/accuracy.json");
  const models =
    accuracy.state === "ready" ? accuracy.data.rows.map((r) => r.model) : [];

  // The same models, reframed: the selected day in Day view, the whole record
  // in Over time view.
  const headline = onDay
    ? day.state === "ready" && day.data.metrics
    : accuracy.state === "ready" && accuracy.data.rows;
  const unpublished = onDay && day.state === "ready" && !day.data.observed;

  return (
    <>
      <header>
        <h1>CZ day-ahead price forecast</h1>
        {extent && (
          <p className="caption">
            {extent.first} – {extent.last} · EUR/MWh
          </p>
        )}
        {extent && isStale(extent, todayInPrague()) && (
          <p className="stale" role="status">
            The daily run has stopped: the latest forecast is for{" "}
            {extent.pending}.
          </p>
        )}
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
          {unpublished ? (
            <p className="note">
              Not published yet: the price clears the day before delivery.
            </p>
          ) : (
            headline && <HeadlineNumbers metric={metric} figures={headline} />
          )}
          {onDay && day.state === "ready" && <DayChart day={day.data} />}
          {onDay &&
            deliveryDate &&
            daily.state === "ready" &&
            daily.data.values.length > 0 && (
              <Ribbon
                daily={daily.data}
                selected={deliveryDate}
                onPick={setPicked}
              />
            )}
          {onDay && extent && deliveryDate && (
            <DayNavigator
              record={extent}
              day={deliveryDate}
              daily={daily.state === "ready" ? daily.data : null}
              onPick={setPicked}
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
