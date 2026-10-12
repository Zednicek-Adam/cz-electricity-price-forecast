/**
 * The dashboard (ADR-0007): one hero chart with two views switched in place,
 * the headline numbers beneath the title, one metric selector governing the
 * page, the day navigator, then the accuracy table and the Diebold–Mariano
 * card.
 *
 * The page holds the state the controls share — the view, the metric, the
 * delivery day and the model the DM card is about — and selects what each view
 * draws out of the one file it was handed. There is no prose: the record says
 * what it is. The two exceptions are claims the record cannot make by itself:
 * the pending day has no price yet, and a daily run that has stopped
 * (ADR-0012).
 */
import { useState } from "react";

import { AccuracyTable } from "./AccuracyTable.tsx";
import { ComparisonCard } from "./ComparisonCard.tsx";
import {
  accuracy,
  comparison,
  dailyMetric,
  deliveryDay,
  runningMetric,
} from "./dashboard.ts";
import { DayChart } from "./DayChart.tsx";
import { DayNavigator } from "./DayNavigator.tsx";
import { Footer } from "./Footer.tsx";
import { HeadlineNumbers } from "./HeadlineNumbers.tsx";
import { MetricSelector } from "./MetricSelector.tsx";
import { OverTimeChart } from "./OverTimeChart.tsx";
import { METRIC_PRESENTATION } from "./presentation.ts";
import { isStale, todayInPrague } from "./record.ts";
import { Ribbon } from "./Ribbon.tsx";
import type { Dashboard, DeliveryDate, Metric, ModelSlug } from "./types.ts";

type View = "day" | "overTime";

export function App({ data }: { data: Dashboard }) {
  const { record, models } = data;
  const [view, setView] = useState<View>("day");
  const [metric, setMetric] = useState<Metric>("mae");
  // The Day view opens on the record's last day, the pending forecast while
  // there is one, rather than on a day picked for how it looks.
  const [deliveryDate, setDeliveryDate] = useState<DeliveryDate>(record.last);
  const [dmModel, setDmModel] = useState<ModelSlug>("chronos2");

  const onDay = view === "day";
  const day = deliveryDay(data, deliveryDate);
  const daily = dailyMetric(data, metric);
  const table = accuracy(data);
  // The same models, reframed: the selected day in Day view, the whole record
  // in Over time view.
  const headline = onDay ? day.metrics : table;
  const unpublished = onDay && !day.observed;

  return (
    <>
      <header>
        <h1>CZ day-ahead price forecast</h1>
        <p className="caption">
          {record.first} – {record.last} · EUR/MWh
        </p>
        {isStale(record, todayInPrague()) && (
          <p className="stale" role="status">
            The daily run has stopped: the latest forecast is for{" "}
            {record.pending}.
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
            <HeadlineNumbers metric={metric} figures={headline} />
          )}
          {onDay && (
            <>
              <DayChart day={day} />
              {daily.values.length > 0 && (
                <Ribbon
                  daily={daily}
                  selected={deliveryDate}
                  onPick={setDeliveryDate}
                />
              )}
              <DayNavigator
                record={record}
                day={deliveryDate}
                daily={daily}
                onPick={setDeliveryDate}
              />
            </>
          )}
          {!onDay && (
            <OverTimeChart
              metric={metric}
              running={runningMetric(data, metric)}
            />
          )}
        </section>
        <section className="card" aria-label="Accuracy">
          <AccuracyTable rows={table} />
        </section>
        {models.length > 1 && (
          <section className="card" aria-label="Diebold–Mariano">
            <ComparisonCard
              comparison={comparison(
                data,
                models.includes(dmModel) ? dmModel : (models[0] as ModelSlug),
              )}
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
