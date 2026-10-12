/**
 * The electricity price chart card that sits above the hero accuracy chart.
 *
 * Provides the same cuts through the record (Day, Over time, By weekday, By hour)
 * and history filter (Whole record, Last 30 days, Last 7 days) to compare
 * how the electricity price behaved and what its distribution was against
 * the model metrics.
 *
 * Freely foldable; defaults to folded on the Day tab where the hero chart already
 * displays the day's price.
 */
import { PriceDayChart } from "./PriceDayChart.tsx";
import { PriceOverTimeChart } from "./PriceOverTimeChart.tsx";
import { PriceProfileChart } from "./PriceProfileChart.tsx";
import {
  priceDay,
  priceOverTime,
  priceProfile,
  type PriceDistribution,
} from "./price.ts";
import { formatDay, formatPrice, SCOPE_LABELS } from "./presentation.ts";
import { Segmented } from "./Segmented.tsx";
import type {
  Dashboard,
  DeliveryDate,
  History,
  Profile,
  View,
} from "./types.ts";

const HISTORIES: readonly History[] = ["whole", "window", "week"];

function scopeRange(data: Dashboard, scope: History): string {
  if (scope !== "whole") return `${data[scope].first} – ${data[scope].last}`;
  const scored = data.running.dates;
  return `${scored[0] ?? data.record.first} – ${scored.at(-1) ?? data.record.last}`;
}

export function PriceHeadlineNumbers({
  dist,
}: {
  dist: PriceDistribution | null;
}) {
  if (!dist) return null;
  return (
    <dl className="headline-numbers">
      <div className="tile">
        <dt>Average price</dt>
        <dd>
          {formatPrice(dist.mean)}
          <span className="unit"> EUR/MWh</span>
        </dd>
      </div>
      <div className="tile">
        <dt>Median price</dt>
        <dd>
          {formatPrice(dist.median)}
          <span className="unit"> EUR/MWh</span>
        </dd>
      </div>
      <div className="tile">
        <dt>Min price</dt>
        <dd>
          {formatPrice(dist.min)}
          <span className="unit"> EUR/MWh</span>
        </dd>
      </div>
      <div className="tile">
        <dt>Max price</dt>
        <dd>
          {formatPrice(dist.max)}
          <span className="unit"> EUR/MWh</span>
        </dd>
      </div>
    </dl>
  );
}

function PriceProfileLegend() {
  return (
    <ul className="legend" aria-label="Price distribution legend">
      <li>
        <span
          className="line-key"
          style={{
            width: 16,
            height: 0,
            borderTop: "2px solid var(--ink)",
          }}
        />
        <span>Median</span>
      </li>
      <li>
        <span
          className="line-key"
          style={{
            width: 16,
            height: 0,
            borderTop: "1.5px dashed var(--ink-2)",
          }}
        />
        <span>Mean</span>
      </li>
      <li>
        <span
          className="line-key"
          style={{
            width: 14,
            height: 10,
            borderRadius: 2,
            background: "rgba(17, 17, 16, 0.16)",
          }}
        />
        <span>50% of prices (IQR)</span>
      </li>
      <li>
        <span
          className="line-key"
          style={{
            width: 14,
            height: 10,
            borderRadius: 2,
            background: "rgba(17, 17, 16, 0.06)",
            border: "1px solid var(--border)",
          }}
        />
        <span>Full range (min – max)</span>
      </li>
    </ul>
  );
}

function PriceOverTimeLegend({
  kind,
  days,
}: {
  kind: "running" | "trailing";
  days: number | null;
}) {
  const label =
    kind === "running" ? "Running mean" : `Trailing ${days}-day mean`;
  return (
    <ul className="legend" aria-label="Price over time legend">
      <li>
        <span
          className="line-key"
          style={{
            width: 16,
            height: 0,
            borderTop: "2px solid var(--ink)",
          }}
        />
        <span>{label}</span>
      </li>
      <li>
        <span
          className="line-key"
          style={{
            width: 16,
            height: 0,
            borderTop: "1px solid rgba(17, 17, 16, 0.3)",
          }}
        />
        <span>Daily mean</span>
      </li>
    </ul>
  );
}

interface PriceCardProps {
  data: Dashboard;
  view: View;
  onView: (view: View) => void;
  scope: History;
  onScope: (scope: History) => void;
  deliveryDate: DeliveryDate;
  isFolded: boolean;
  onToggleFold: () => void;
}

export function PriceCard({
  data,
  view,
  onView,
  scope,
  onScope,
  deliveryDate,
  isFolded,
  onToggleFold,
}: PriceCardProps) {
  return (
    <section
      className="card hero price-card"
      aria-label="Electricity price chart"
    >
      <div className="price-top-bar">
        <PriceTabs view={view} onChange={onView} />
        <button
          type="button"
          className="fold-toggle"
          onClick={onToggleFold}
          aria-expanded={!isFolded}
        >
          {isFolded ? "Unfold price chart" : "Fold price chart"}
        </button>
      </div>

      {isFolded ? (
        <div className="folded-message">
          <p className="subtle">
            Electricity price chart is folded ·{" "}
            <button
              type="button"
              className="link-button"
              onClick={onToggleFold}
            >
              Unfold
            </button>{" "}
            to compare with model metrics
          </p>
        </div>
      ) : (
        <div
          role="tabpanel"
          id="price-panel"
          aria-labelledby={`price-tab-${view}`}
          className="panel"
        >
          {view === "day" ? (
            <PriceDayView data={data} date={deliveryDate} />
          ) : view === "overTime" ? (
            <PriceTrendView data={data} scope={scope} onScope={onScope} />
          ) : (
            <PriceProfileView
              data={data}
              by={view}
              scope={scope}
              onScope={onScope}
            />
          )}
        </div>
      )}
    </section>
  );
}

const VIEWS: { id: View; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "overTime", label: "Over time" },
  { id: "weekday", label: "By weekday" },
  { id: "period", label: "By hour" },
];

function PriceTabs({
  view,
  onChange,
}: {
  view: View;
  onChange: (view: View) => void;
}) {
  return (
    <div
      className="tabs"
      role="tablist"
      aria-label="Electricity price chart view"
    >
      {VIEWS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`price-tab-${id}`}
          aria-selected={id === view}
          aria-controls="price-panel"
          tabIndex={id === view ? 0 : -1}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function PriceDayView({ data, date }: { data: Dashboard; date: DeliveryDate }) {
  const day = priceDay(data, date);
  const unpublished = !day.observed;

  return (
    <>
      <div className="panel-bar">
        <div>
          <p className="price-eyebrow">
            {unpublished
              ? "Electricity price · forecast"
              : "Electricity price · observed"}
          </p>
          <h2>{formatDay(date)}</h2>
        </div>
      </div>
      <PriceHeadlineNumbers dist={day.distribution} />
      <PriceDayChart day={day} />
    </>
  );
}

function PriceTrendView({
  data,
  scope,
  onScope,
}: {
  data: Dashboard;
  scope: History;
  onScope: (scope: History) => void;
}) {
  const running = scope === "whole";
  const overTime = priceOverTime(data, scope);

  return (
    <>
      <div className="panel-bar">
        <div>
          <p className="price-eyebrow">
            {running
              ? "Running average price · from the first scored day"
              : `Trailing ${overTime.days}-day window`}
          </p>
          <h2>
            {running
              ? "Electricity price over time"
              : `${overTime.days}-day electricity price`}
          </h2>
        </div>
        <div className="chart-switches">
          <Segmented
            label="Price history"
            options={HISTORIES}
            value={scope}
            onChange={onScope}
            name={(s) => SCOPE_LABELS[s]}
          />
        </div>
      </div>
      <p className="subtle price-tiles-caption">
        {SCOPE_LABELS[scope]} · {scopeRange(data, scope)}
      </p>
      <PriceHeadlineNumbers dist={overTime.overall} />
      <PriceOverTimeLegend kind={overTime.kind} days={overTime.days} />
      <PriceOverTimeChart overTime={overTime} />
    </>
  );
}

function PriceProfileView({
  data,
  by,
  scope,
  onScope,
}: {
  data: Dashboard;
  by: Profile;
  scope: History;
  onScope: (scope: History) => void;
}) {
  const profile = priceProfile(data, by, scope);

  return (
    <>
      <div className="panel-bar">
        <div>
          <p className="price-eyebrow">
            {SCOPE_LABELS[scope]} · {scopeRange(data, scope)}
          </p>
          <h2>Electricity price by {by === "weekday" ? "weekday" : "hour"}</h2>
        </div>
        <div className="chart-switches">
          <Segmented
            label="Price history"
            options={HISTORIES}
            value={scope}
            onChange={onScope}
            name={(s) => SCOPE_LABELS[s]}
          />
        </div>
      </div>
      <PriceHeadlineNumbers dist={profile.overall} />
      <PriceProfileLegend />
      <PriceProfileChart profile={profile} />
    </>
  );
}
