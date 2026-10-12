/**
 * The dashboard (ADR-0007, ADR-0017, ADR-0018): one hero chart with four views
 * behind tabs, then the scoreboard.
 *
 * - **Day** — one delivery day's prices. Its metric selector sits in the
 *   day's accuracy panel beneath the chart, because there it rescores the
 *   day, the ribbon and the day navigator and never the chart.
 * - **Over time** — the running metric over the whole record, or the trailing
 *   30-day or 7-day metric.
 * - **By weekday** and **By hour** — the metric per weekday and per period
 *   ordinal, over the whole record or the last 30 or 7 days.
 *
 *   These three views share two switches in the chart's own bar, the history
 *   and the metric, because there they redraw the chart.
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
  metricProfile,
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
import { PriceCard } from "./PriceChart.tsx";
import { ProfileChart } from "./ProfileChart.tsx";
import { isStale, todayInPrague } from "./record.ts";
import { Ribbon } from "./Ribbon.tsx";
import { Segmented } from "./Segmented.tsx";
import type {
  Dashboard,
  DeliveryDate,
  History,
  Metric,
  ModelSlug,
  Profile,
  Scope,
} from "./types.ts";

type View = "day" | "overTime" | Profile;

const VIEWS: { id: View; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "overTime", label: "Over time" },
  { id: "weekday", label: "By weekday" },
  { id: "period", label: "By hour" },
];

const SCOPES: readonly Scope[] = ["whole", "window"];
const HISTORIES: readonly History[] = ["whole", "window", "week"];

export function App({ data }: { data: Dashboard }) {
  const { record, models } = data;
  const [view, setView] = useState<View>("day");
  // Two metric selectors, two choices: the Day view's scores the day, the
  // other views' draws the chart (ADR-0017).
  const [dayMetric, setDayMetric] = useState<Metric>("mae");
  const [chartMetric, setChartMetric] = useState<Metric>("mae");
  // The history the chart views cover, separate from the scoreboard's scope
  // (ADR-0018).
  const [history, setHistory] = useState<History>("whole");
  // Electricity price chart folded state: defaults to folded on Day, unfolded on other views
  const [isPriceFolded, setIsPriceFolded] = useState<boolean>(true);
  // The Day view opens on the record's last day, the pending forecast while
  // there is one, rather than on a day picked for how it looks.
  const [deliveryDate, setDeliveryDate] = useState<DeliveryDate>(record.last);
  const [dmModel, setDmModel] = useState<ModelSlug>(HEADLINE_MODEL);
  const [scope, setScope] = useState<Scope>("whole");

  function handleViewChange(nextView: View): void {
    setView(nextView);
    setIsPriceFolded(nextView === "day");
  }

  function openDay(day: DeliveryDate): void {
    setDeliveryDate(day);
    handleViewChange("day");
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
        <PriceCard
          data={data}
          view={view}
          onView={handleViewChange}
          scope={history}
          onScope={setHistory}
          deliveryDate={deliveryDate}
          isFolded={isPriceFolded}
          onToggleFold={() => setIsPriceFolded((f) => !f)}
        />
        <section className="card hero" aria-label="Hero chart">
          <ViewTabs view={view} onChange={handleViewChange} />
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
            ) : view === "overTime" ? (
              <TrendView
                data={data}
                scope={history}
                onScope={setHistory}
                metric={chartMetric}
                onMetric={setChartMetric}
              />
            ) : (
              <ProfileView
                data={data}
                by={view}
                scope={history}
                onScope={setHistory}
                metric={chartMetric}
                onMetric={setChartMetric}
              />
            )}
          </div>
        </section>

        <section className="scoreboard" aria-labelledby="scoreboard-title">
          <div className="section-bar">
            <div>
              <h2 id="scoreboard-title">Scoreboard</h2>
              <p className="subtle">
                {SCOPE_LABELS[scope]} · {scopeRange(data, scope)}
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

/** The hero chart's four views, as a tab list with arrow-key navigation. */
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

/** The days a scope covers, first – last. */
function scopeRange(data: Dashboard, scope: History): string {
  if (scope !== "whole") return `${data[scope].first} – ${data[scope].last}`;
  const scored = data.running.dates;
  return `${scored[0] ?? data.record.first} – ${scored.at(-1) ?? data.record.last}`;
}

interface ChartViewProps {
  data: Dashboard;
  scope: History;
  onScope: (scope: History) => void;
  metric: Metric;
  onMetric: (metric: Metric) => void;
}

/** The chart views' two switches, in the chart's bar because both redraw it:
 * how much history the chart covers, and the metric. */
function ChartSwitches({ scope, onScope, metric, onMetric }: ChartViewProps) {
  return (
    <div className="chart-switches">
      <Segmented
        label="History"
        options={HISTORIES}
        value={scope}
        onChange={onScope}
        name={(s) => SCOPE_LABELS[s]}
      />
      <MetricSelector metric={metric} onChange={onMetric} />
    </div>
  );
}

/** Over time: over the whole record the running metric, over the last 30 or
 * 7 days the trailing one, across the whole record. */
function TrendView(props: ChartViewProps) {
  const { data, scope, metric } = props;
  const running = scope === "whole";
  const series = metricOverTime(data, scope, metric);
  const { label } = METRIC_PRESENTATION[metric];
  // The tiles are the lines' last points: the whole record, or the last
  // window, each as published.
  const figures = accuracy(data, scope);

  return (
    <>
      <div className="panel-bar">
        <div>
          <p className="eyebrow">
            {running
              ? "Running metric · from the first scored day"
              : `Trailing ${series.days}-day window`}
          </p>
          <h2>
            {running ? `${label} over time` : `${series.days}-day ${label}`}
          </h2>
        </div>
        <ChartSwitches {...props} />
      </div>
      <p className="subtle tiles-caption">
        {SCOPE_LABELS[scope]} · {scopeRange(data, scope)}
      </p>
      <HeadlineNumbers metric={metric} figures={figures} />
      <Legend series={series.series.map((s) => s.model)} />
      <OverTimeChart series={series} />
    </>
  );
}

function ProfileView(props: ChartViewProps & { by: Profile }) {
  const { data, by, scope, metric } = props;
  const profile = metricProfile(data, by, scope, metric);
  const { label } = METRIC_PRESENTATION[metric];

  return (
    <>
      <div className="panel-bar">
        <div>
          <p className="eyebrow">
            {SCOPE_LABELS[scope]} · {scopeRange(data, scope)}
          </p>
          <h2>
            {label} by {by === "weekday" ? "weekday" : "hour"}
          </h2>
        </div>
        <ChartSwitches {...props} />
      </div>
      <Legend series={profile.series.map((s) => s.model)} />
      <ProfileChart profile={profile} />
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
