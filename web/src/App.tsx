/**
 * The dashboard (ADR-0007, ADR-0017): one hero chart with three views behind
 * tabs, then the scoreboard.
 *
 * - **Day** — one delivery day's prices. Its metric selector sits in the
 *   day's accuracy panel beneath the chart, because there it rescores the
 *   day, the ribbon and the day navigator and never the chart.
 * - **Over time** and **30 days** — the running and the trailing metric. Their
 *   shared metric selector sits in the chart's own bar, because there it
 *   redraws the chart.
 * - **Scoreboard** — the accuracy table and the Diebold–Mariano card, under one
 *   scope switch: the whole record or the last 30 days.
 *
 * The page holds the state the controls share and selects what each view
 * draws out of the one file it was handed. There is no explanatory prose: the
 * record says what it is. The two exceptions are claims the record cannot make
 * by itself: the pending day has no price yet, and a daily run that has
 * stopped (ADR-0012).
 */
import { useRef, useState, type KeyboardEvent } from "react";

import { AccuracyTable } from "./AccuracyTable.tsx";
import { ComparisonCard } from "./ComparisonCard.tsx";
import {
  accuracy,
  comparison,
  dailyMetric,
  deliveryDay,
  HEADLINE_MODEL,
  metricOverTime,
} from "./dashboard.ts";
import { DayChart } from "./DayChart.tsx";
import { DateStepper, DayJumps } from "./DayNavigator.tsx";
import { Footer } from "./Footer.tsx";
import { HeadlineNumbers } from "./HeadlineNumbers.tsx";
import { Legend } from "./Legend.tsx";
import { MetricSelector } from "./MetricSelector.tsx";
import { OverTimeChart } from "./OverTimeChart.tsx";
import {
  formatDay,
  METRIC_PRESENTATION,
  MODEL_LABELS,
  SCOPE_LABELS,
} from "./presentation.ts";
import { isStale, todayInPrague } from "./record.ts";
import { Ribbon } from "./Ribbon.tsx";
import { Segmented } from "./Segmented.tsx";
import type {
  Dashboard,
  DeliveryDate,
  Metric,
  ModelSlug,
  Scope,
} from "./types.ts";

type View = "day" | "overTime" | "trailing";

const VIEWS: { id: View; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "overTime", label: "Over time" },
  { id: "trailing", label: "30 days" },
];

const SCOPES: readonly Scope[] = ["whole", "window"];

export function App({ data }: { data: Dashboard }) {
  const { record, models, window } = data;
  const [view, setView] = useState<View>("day");
  // Two metric selectors, two choices: the Day view's scores the day, the
  // trend views' draws the chart (ADR-0017).
  const [dayMetric, setDayMetric] = useState<Metric>("mae");
  const [trendMetric, setTrendMetric] = useState<Metric>("mae");
  // The Day view opens on the record's last day, the pending forecast while
  // there is one, rather than on a day picked for how it looks.
  const [deliveryDate, setDeliveryDate] = useState<DeliveryDate>(record.last);
  const [dmModel, setDmModel] = useState<ModelSlug>(HEADLINE_MODEL);
  const [scope, setScope] = useState<Scope>("whole");

  const scored = data.running.dates;
  const scopeRange =
    scope === "whole"
      ? `${scored[0] ?? record.first} – ${scored.at(-1) ?? record.last}`
      : `${window.first} – ${window.last}`;

  function openDay(day: DeliveryDate): void {
    setDeliveryDate(day);
    setView("day");
  }

  return (
    <>
      <header className="masthead">
        <div className="brand">
          <Logo />
          <div>
            <h1>CZ day-ahead price forecast</h1>
            <p className="subtle">
              Czech bidding zone · EUR/MWh · {record.first} – {record.last}
            </p>
          </div>
        </div>
        {record.pending && (
          <button
            type="button"
            className="pending-chip"
            onClick={() => openDay(record.pending as DeliveryDate)}
          >
            <span className="pulse" aria-hidden="true" />
            Latest forecast · {formatDay(record.pending)}
          </button>
        )}
      </header>
      {isStale(record, todayInPrague()) && (
        <p className="stale" role="status">
          The daily run has stopped: the latest forecast is for {record.pending}
          .
        </p>
      )}
      <main>
        <section className="card hero" aria-label="Hero chart">
          <ViewTabs view={view} onChange={setView} />
          <div
            role="tabpanel"
            id="hero-panel"
            aria-labelledby={`tab-${view}`}
            className="panel"
          >
            {view === "day" ? (
              <DayView
                data={data}
                date={deliveryDate}
                metric={dayMetric}
                onMetric={setDayMetric}
                onPick={setDeliveryDate}
              />
            ) : (
              <TrendView
                data={data}
                kind={view === "overTime" ? "running" : "trailing"}
                metric={trendMetric}
                onMetric={setTrendMetric}
              />
            )}
          </div>
        </section>

        <section className="scoreboard" aria-labelledby="scoreboard-title">
          <div className="section-bar">
            <div>
              <h2 id="scoreboard-title">Scoreboard</h2>
              <p className="subtle">
                {SCOPE_LABELS[scope]} · {scopeRange}
              </p>
            </div>
            <Segmented
              label="Scope"
              options={SCOPES}
              value={scope}
              onChange={setScope}
              name={(s) => SCOPE_LABELS[s]}
            />
          </div>
          <div className="card" role="region" aria-label="Accuracy">
            <div className="card-bar">
              <h3>Accuracy</h3>
            </div>
            <AccuracyTable rows={accuracy(data, scope)} scope={scope} />
          </div>
          {models.length > 1 && (
            <div className="card" role="region" aria-label="Diebold–Mariano">
              <ComparisonCard
                comparison={comparison(
                  data,
                  models.includes(dmModel) ? dmModel : (models[0] as ModelSlug),
                  scope,
                )}
                models={models}
                onModel={setDmModel}
              />
            </div>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}

/** The hero chart's three views, as a tab list with arrow-key navigation. */
function ViewTabs({
  view,
  onChange,
}: {
  view: View;
  onChange: (view: View) => void;
}) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(event: KeyboardEvent<HTMLDivElement>): void {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const at = VIEWS.findIndex((v) => v.id === view);
    const next = (at + step + VIEWS.length) % VIEWS.length;
    onChange((VIEWS[next] as (typeof VIEWS)[number]).id);
    tabs.current[next]?.focus();
  }

  return (
    <div
      className="tabs"
      role="tablist"
      aria-label="Hero chart view"
      onKeyDown={move}
    >
      {VIEWS.map(({ id, label }, i) => (
        <button
          key={id}
          ref={(element) => {
            tabs.current[i] = element;
          }}
          type="button"
          role="tab"
          id={`tab-${id}`}
          aria-selected={id === view}
          aria-controls="hero-panel"
          tabIndex={id === view ? 0 : -1}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

interface DayViewProps {
  data: Dashboard;
  date: DeliveryDate;
  metric: Metric;
  onMetric: (metric: Metric) => void;
  onPick: (day: DeliveryDate) => void;
}

function DayView({ data, date, metric, onMetric, onPick }: DayViewProps) {
  const day = deliveryDay(data, date);
  const daily = dailyMetric(data, metric);
  const unpublished = !day.observed;
  const { label } = METRIC_PRESENTATION[metric];

  return (
    <>
      <div className="panel-bar">
        <div>
          <p className="eyebrow">
            {unpublished ? "Delivery day · forecast" : "Delivery day"}
          </p>
          <h2>{formatDay(date)}</h2>
        </div>
        <DateStepper record={data.record} day={date} onPick={onPick} />
      </div>
      <Legend
        series={[
          ...(day.observed ? (["observed"] as const) : []),
          ...day.forecasts.map((f) => f.model),
        ]}
      />
      <DayChart day={day} />
      <div className="scoring" role="region" aria-label="Day accuracy">
        <div className="scoring-bar">
          <h3>Accuracy on this day</h3>
          <MetricSelector metric={metric} onChange={onMetric} size="small" />
        </div>
        {unpublished ? (
          <p className="note">
            Not published yet: the price clears the day before delivery.
          </p>
        ) : (
          <HeadlineNumbers metric={metric} figures={day.metrics} />
        )}
        {daily.values.length > 0 && (
          <>
            <div className="ribbon-bar">
              <p className="subtle">
                {MODEL_LABELS[daily.model]} · daily {label} on every scored day
                · click to open a day
              </p>
              <DayJumps daily={daily} onPick={onPick} />
            </div>
            <Ribbon daily={daily} selected={date} onPick={onPick} />
          </>
        )}
      </div>
    </>
  );
}

interface TrendViewProps {
  data: Dashboard;
  kind: "running" | "trailing";
  metric: Metric;
  onMetric: (metric: Metric) => void;
}

function TrendView({ data, kind, metric, onMetric }: TrendViewProps) {
  const series = metricOverTime(data, kind, metric);
  const { label } = METRIC_PRESENTATION[metric];
  const scored = data.running.dates;
  const running = kind === "running";
  // The tiles are the lines' last points: the whole record, or the last
  // window, each as published.
  const figures = accuracy(data, running ? "whole" : "window");

  return (
    <>
      <div className="panel-bar">
        <div>
          <p className="eyebrow">
            {running
              ? "Running metric · from the first scored day"
              : "Trailing 30-day window"}
          </p>
          <h2>{running ? `${label} over time` : `30-day ${label}`}</h2>
        </div>
        <MetricSelector metric={metric} onChange={onMetric} />
      </div>
      <p className="subtle tiles-caption">
        {running
          ? `Whole record · ${scored[0] ?? ""} – ${scored.at(-1) ?? ""}`
          : `Last 30 days · ${data.window.first} – ${data.window.last}`}
      </p>
      <HeadlineNumbers metric={metric} figures={figures} />
      <Legend series={series.series.map((s) => s.model)} />
      <OverTimeChart series={series} />
    </>
  );
}

function Logo() {
  return (
    <svg
      className="logo"
      width="36"
      height="36"
      viewBox="0 0 36 36"
      aria-hidden="true"
    >
      <rect width="36" height="36" rx="9" fill="var(--ink)" />
      <path
        d="M7 24.5 12.5 19l4 3.5 6-9 6.5 5"
        fill="none"
        stroke="var(--series-chronos2-bright)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="29" cy="18.5" r="2.4" fill="#fff" />
    </svg>
  );
}
