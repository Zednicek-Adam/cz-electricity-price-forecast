/**
 * The dashboard (ADR-0007, ADR-0017, ADR-0018, ADR-0019): one hero chart with
 * four views behind tabs, the price chart under it, then the scoreboard.
 *
 * - **Price chart** — the observed price's distribution over the cut the hero
 *   chart shows, under the hero chart, so folding it never moves that chart.
 *   Its tabs and history switch are the hero chart's own, drawn a second
 *   time, so the two charts always show the same cut. It folds away to one
 *   bar that opens it again. The Day view opens with it folded, since
 *   that view's chart is the day's price; unfolded there, it draws the daily
 *   price with the open day marked. Its Over time shares the hero chart's
 *   zoom: a span of days both draw.
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
  priceOverTime,
  priceProfile,
} from "./dashboard.ts";
import { DayChart } from "./DayChart.tsx";
import { DateStepper, DayJumps } from "./DayNavigator.tsx";
import { Footer } from "./Footer.tsx";
import { HeadlineNumbers } from "./HeadlineNumbers.tsx";
import { Legend } from "./Legend.tsx";
import { MetricSelector } from "./MetricSelector.tsx";
import { OverTimeChart } from "./OverTimeChart.tsx";
import {
  PriceKey,
  PriceOverTimeChart,
  PriceProfileChart,
  PriceSparkline,
} from "./PriceChart.tsx";
import {
  formatDay,
  METRIC_PRESENTATION,
  MODEL_LABELS,
  SCOPE_LABELS,
} from "./presentation.ts";
import { ProfileChart } from "./ProfileChart.tsx";
import { isStale, todayInPrague } from "./record.ts";
import { Ribbon } from "./Ribbon.tsx";
import { Segmented } from "./Segmented.tsx";
import { ZoomBar, type Zoom } from "./Zoom.tsx";
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
  // The Day view opens on the record's last day, the pending forecast while
  // there is one, rather than on a day picked for how it looks.
  const [deliveryDate, setDeliveryDate] = useState<DeliveryDate>(record.last);
  const [dmModel, setDmModel] = useState<ModelSlug>(HEADLINE_MODEL);
  const [scope, setScope] = useState<Scope>("whole");
  // Whether the price chart is unfolded, kept apart for the Day view: it
  // opens folded there, as that view's chart is the day's price (ADR-0019).
  const [dayPricesOpen, setDayPricesOpen] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(true);
  // The span of days both Over time charts draw; null draws them all.
  const [zoom, setZoom] = useState<Zoom>(null);

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
          <ViewTabs
            id="hero"
            label="Hero chart view"
            view={view}
            onChange={setView}
          />
          <div
            role="tabpanel"
            id="hero-panel"
            aria-labelledby={`hero-tab-${view}`}
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
                zoom={zoom}
                onZoom={setZoom}
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
        <section className="card hero prices" aria-label="Price chart">
          <PriceCard
            data={data}
            view={view}
            onView={setView}
            date={deliveryDate}
            history={history}
            onHistory={setHistory}
            open={view === "day" ? dayPricesOpen : pricesOpen}
            onOpen={view === "day" ? setDayPricesOpen : setPricesOpen}
            zoom={zoom}
            onZoom={setZoom}
          />
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

/** The hero chart's four views, as a tab list with arrow-key navigation. The
 * price chart draws the same list a second time, as `id` "price", for its
 * own panel. */
function ViewTabs({
  id: list,
  label,
  view,
  onChange,
}: {
  id: "hero" | "price";
  label: string;
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
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={move}>
      {VIEWS.map(({ id, label }, i) => (
        <button
          key={id}
          ref={(element) => {
            tabs.current[i] = element;
          }}
          type="button"
          role="tab"
          id={`${list}-tab-${id}`}
          aria-selected={id === view}
          aria-controls={`${list}-panel`}
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
function TrendView(
  props: ChartViewProps & { zoom: Zoom; onZoom: (zoom: Zoom) => void },
) {
  const { data, scope, metric, zoom, onZoom } = props;
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
      <OverTimeChart series={series} zoom={zoom} onZoom={onZoom} />
      <ZoomBar days={series.deliveryDates} zoom={zoom} onZoom={onZoom} />
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

interface PriceCardProps {
  data: Dashboard;
  view: View;
  onView: (view: View) => void;
  date: DeliveryDate;
  history: History;
  onHistory: (history: History) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
}

/** The price chart. Unfolded: a bar with the hero chart's tabs and a fold
 * button, and beneath it the price over the hero chart's cut. Folded: one
 * button across the bar, naming what it would draw beside a preview of it. */
function PriceCard(props: PriceCardProps) {
  const { data, view, onView, date, history, onHistory, open, onOpen } = props;
  // Whether the box plots draw the minimum and maximum; kept while folded.
  const [extremes, setExtremes] = useState(false);

  if (!open) {
    return (
      <>
        <div className="tabs-bar">
          <button
            type="button"
            className="fold-bar"
            aria-expanded={false}
            aria-controls="price-panel"
            aria-label="Show the price chart"
            aria-describedby="price-summary"
            onClick={() => onOpen(true)}
          >
            <span className="tabs-title">Price</span>
            <span id="price-summary" className="fold-summary">
              {priceTitle(data, view, history)} · {SCOPE_LABELS[history]}
            </span>
            <PriceSparkline values={priceMeans(data, view, history)} />
            <span className="fold-action">
              <span className="chevron" aria-hidden="true" />
              Show
            </span>
          </button>
        </div>
        <div id="price-panel" className="panel" hidden />
      </>
    );
  }

  return (
    <>
      <div className="tabs-bar">
        <h2 className="tabs-title">Price</h2>
        <ViewTabs
          id="price"
          label="Price chart view"
          view={view}
          onChange={onView}
        />
        <button
          type="button"
          className="fold"
          aria-expanded={true}
          aria-controls="price-panel"
          aria-label="Hide the price chart"
          onClick={() => onOpen(false)}
        >
          <span className="chevron" aria-hidden="true" />
          Hide
        </button>
      </div>
      <div
        role="tabpanel"
        id="price-panel"
        aria-labelledby={`price-tab-${view}`}
        className="panel"
      >
        <PriceView
          data={data}
          view={view}
          date={date}
          history={history}
          onHistory={onHistory}
          extremes={extremes}
          onExtremes={setExtremes}
          zoom={props.zoom}
          onZoom={props.onZoom}
        />
      </div>
    </>
  );
}

/** The price chart's title; the Day view draws the Over time chart. */
function priceTitle(data: Dashboard, view: View, history: History): string {
  if (view === "weekday" || view === "period") {
    return `Price by ${view === "weekday" ? "weekday" : "hour"}`;
  }
  return history === "whole"
    ? "Daily price"
    : `${data[history].days}-day price`;
}

/** The means the price chart would draw, for the folded bar's preview. */
function priceMeans(
  data: Dashboard,
  view: View,
  history: History,
): (number | null)[] {
  return view === "weekday" || view === "period"
    ? priceProfile(data, view, history).distribution.mean
    : priceOverTime(data, history).distribution.mean;
}

/** The observed price over the cut the hero chart shows: each day's or each
 * trailing span's prices in Over time, each bucket's in a profile. */
function PriceView({
  data,
  view,
  date,
  history,
  onHistory,
  extremes,
  onExtremes,
  zoom,
  onZoom,
}: {
  data: Dashboard;
  view: View;
  date: DeliveryDate;
  history: History;
  onHistory: (history: History) => void;
  extremes: boolean;
  onExtremes: (extremes: boolean) => void;
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
}) {
  const profile = view === "weekday" || view === "period";
  // On the Day view, the open day is marked; the pending day has no price.
  const prices = priceOverTime(data, history);
  const marked =
    view === "day" && prices.deliveryDates.includes(date) ? date : undefined;

  return (
    <>
      <div className="panel-bar">
        <div>
          <p className="eyebrow">
            {SCOPE_LABELS[history]} · {scopeRange(data, history)}
          </p>
          <h3 className="panel-title">{priceTitle(data, view, history)}</h3>
        </div>
        <div className="chart-switches">
          {profile && (
            <button
              type="button"
              role="switch"
              className="toggle"
              aria-checked={extremes}
              onClick={() => onExtremes(!extremes)}
            >
              <span className="toggle-track" aria-hidden="true" />
              Min – max
            </button>
          )}
          <Segmented
            label="Price chart history"
            options={HISTORIES}
            value={history}
            onChange={onHistory}
            name={(s) => SCOPE_LABELS[s]}
          />
        </div>
      </div>
      <PriceKey
        box={profile}
        extremes={profile && extremes}
        day={marked && formatDay(marked)}
      />
      {!profile ? (
        <>
          <PriceOverTimeChart
            prices={prices}
            zoom={zoom}
            onZoom={onZoom}
            marked={marked}
          />
          <ZoomBar days={data.running.dates} zoom={zoom} onZoom={onZoom} />
        </>
      ) : (
        <PriceProfileChart
          prices={priceProfile(data, view, history)}
          extremes={extremes}
        />
      )}
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
