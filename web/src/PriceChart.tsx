/**
 * The price chart below the hero chart (ADR-0019): the observed price's
 * distribution over the same cut the hero chart's metric takes, so a miss can
 * be read against how the price behaved.
 *
 * - **Over time** — on every scored delivery day, its own 24 prices over the
 *   whole record, or the trailing 30 or 7 days' prices: the mean as a line,
 *   the 25–75% and 10–90% ranges as two bands.
 * - **By weekday** and **By hour** — in each bucket, a box from the 25th to
 *   the 75th percentile, the median across it, whiskers to the 10th and 90th
 *   and the mean as a dot.
 *
 * The extremes are in the tooltip, and on the plot only when the min–max
 * switch is on, as a dashed whisker beyond each box: a 2022 spike or a sunny
 * Sunday's negative hour would otherwise flatten everything else. Over time
 * shares the hero chart's zoom, and on the Day view it marks the day open
 * above it. The chart has the hero chart's width and margins, so its x axis
 * lines up with the one above.
 */
import type {
  DeliveryDate,
  PriceDistribution,
  PriceOverTime,
  PriceProfile,
  PriceStatistic,
} from "./types.ts";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { Area, LinePath } from "@visx/shape";
import { useState } from "react";

import {
  TICK_LABEL,
  TimeAxis,
  Tooltip,
  YGrid,
  type TooltipRow,
} from "./ChartParts.tsx";
import { formatTick, paddedDomain } from "./charts.ts";
import { formatPrice, SCOPE_LABELS, WEEKDAYS } from "./presentation.ts";
import { Selection, useDragZoom, zoomRange, type Zoom } from "./Zoom.tsx";

const WIDTH = 960;
const HEIGHT = 260;
const MARGIN = { top: 26, right: 96, bottom: 30, left: 48 };
const BOTTOM = HEIGHT - MARGIN.bottom;

/** The scale spans the 10–90% ranges, or the extremes when they are drawn. */
function priceScale(d: PriceDistribution, extremes = false) {
  const [lo, hi] = extremes ? [d.min, d.max] : [d.p10, d.p90];
  const values = [...lo, ...hi].filter((v): v is number => v !== null);
  return scaleLinear({
    domain: paddedDomain(values.length ? values : [0, 1], 0.08),
    range: [BOTTOM, MARGIN.top],
    clamp: true,
    nice: true,
  });
}

function range(lo: number | null, hi: number | null): string {
  return lo === null || hi === null
    ? "–"
    : `${formatPrice(lo)} – ${formatPrice(hi)}`;
}

/** Each statistic's mark, as a key: the over-time chart draws the mean as a
 * line and the ranges as bands; the box chart the mean as a dot, the median
 * as a line, the 25–75% as the box and the 10–90% as its whisker. */
function swatch(mark: string) {
  return <span className={`price-swatch price-${mark}`} aria-hidden="true" />;
}

function marks(box: boolean) {
  return {
    mean: swatch(box ? "dot" : "line"),
    median: swatch("line"),
    inner: swatch(box ? "box" : "inner"),
    outer: swatch(box ? "whisker" : "outer"),
    extremes: swatch("extremes"),
  };
}

/** The tooltip's readout of one distribution at index `i`; the extremes are
 * here and nowhere on the plot. */
function readout(d: PriceDistribution, i: number, box: boolean): TooltipRow[] {
  const key = marks(box);
  const price = (v: number | null | undefined) =>
    v === null || v === undefined ? "–" : formatPrice(v);
  return [
    { key: key.mean, label: "Mean", value: price(d.mean[i]) },
    ...(box
      ? [{ key: key.median, label: "Median", value: price(d.median[i]) }]
      : []),
    {
      key: key.inner,
      label: "25–75%",
      value: range(d.q1[i] ?? null, d.q3[i] ?? null),
    },
    {
      key: key.outer,
      label: "10–90%",
      value: range(d.p10[i] ?? null, d.p90[i] ?? null),
    },
    {
      key: box ? key.extremes : undefined,
      label: "Min – max",
      value: range(d.min[i] ?? null, d.max[i] ?? null),
    },
  ];
}

/** What the marks mean, above the chart, where the hero chart's legend is. */
export function PriceKey({
  box,
  extremes = false,
  day,
}: {
  box: boolean;
  extremes?: boolean;
  /** The marked day's label, on the Day view. */
  day?: string | undefined;
}) {
  const key = marks(box);
  return (
    <ul className="legend" aria-label="Legend">
      <li>
        {key.mean}
        Mean
      </li>
      {box && (
        <li>
          {key.median}
          Median
        </li>
      )}
      <li>
        {key.inner}
        25–75%
      </li>
      <li>
        {key.outer}
        10–90%
      </li>
      {extremes && (
        <li>
          {key.extremes}
          Min – max
        </li>
      )}
      {day && (
        <li>
          {swatch("day")}
          {day}
        </li>
      )}
    </ul>
  );
}

function PriceAxis({ y }: { y: ReturnType<typeof priceScale> }) {
  const ticks = y.ticks(4);
  return (
    <>
      <text x={4} y={12} {...TICK_LABEL}>
        Price · EUR/MWh
      </text>
      <YGrid
        ticks={ticks}
        y={y}
        left={MARGIN.left}
        right={WIDTH - MARGIN.right}
      />
      <AxisLeft
        scale={y}
        left={MARGIN.left}
        tickValues={ticks}
        hideAxisLine
        hideTicks
        tickFormat={(v) => formatTick(Number(v))}
        tickLabelProps={{ ...TICK_LABEL, dx: -4 }}
      />
    </>
  );
}

interface OverTimeProps {
  prices: PriceOverTime;
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
  /** The Day view's delivery day, marked when the chart draws it. */
  marked?: DeliveryDate | undefined;
}

export function PriceOverTimeChart({
  prices,
  zoom,
  onZoom,
  marked,
}: OverTimeProps) {
  const { kind } = prices;
  // The zoomed days, and the distribution cut to them.
  const [start, end] = zoomRange(prices.deliveryDates, zoom);
  const days = prices.deliveryDates.slice(start, end + 1);
  const d = Object.fromEntries(
    Object.entries(prices.distribution).map(([stat, values]) => [
      stat,
      values.slice(start, end + 1),
    ]),
  ) as Record<PriceStatistic, (number | null)[]>;
  const last = Math.max(days.length - 1, 1);
  const indices = days.map((_, i) => i);

  const x = scaleLinear({
    domain: [0, last],
    range: [MARGIN.left, WIDTH - MARGIN.right],
  });
  const y = priceScale(d);
  const at = (values: (number | null)[]) => (i: number) => y(values[i] ?? 0);
  const has =
    (...series: (number | null)[][]) =>
    (i: number) =>
      series.every((s) => (s[i] ?? null) !== null);
  const described =
    kind === "daily"
      ? "Each delivery day's observed price"
      : `The observed price over the trailing ${prices.days} days`;

  function indexAt(fraction: number): number {
    const index = Math.round(x.invert(fraction * WIDTH));
    return Math.max(0, Math.min(days.length - 1, index));
  }
  const { hovered, anchor, handlers } = useDragZoom(days, indexAt, onZoom);

  const mean = hovered === null ? null : (d.mean[hovered] ?? null);
  const day = marked === undefined ? -1 : days.indexOf(marked);
  const dayMean = day < 0 ? null : (d.mean[day] ?? null);

  return (
    <div className="chart-frame">
      <div className="chart">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${described}, its mean with the 25–75% and 10–90% ranges, in EUR/MWh, on every delivery day from ${
            days[0] ?? ""
          } to ${days.at(-1) ?? ""}.`}
          className="zoomable"
          {...handlers}
        >
          <PriceAxis y={y} />
          <TimeAxis
            days={days}
            x={x}
            top={MARGIN.top}
            bottom={BOTTOM}
            left={MARGIN.left}
            right={WIDTH - MARGIN.right}
          />
          <Area
            data={indices}
            defined={has(d.p10, d.p90)}
            x={(i) => x(i)}
            y0={at(d.p10)}
            y1={at(d.p90)}
            fill="var(--price-outer)"
          />
          <Area
            data={indices}
            defined={has(d.q1, d.q3)}
            x={(i) => x(i)}
            y0={at(d.q1)}
            y1={at(d.q3)}
            fill="var(--price-inner)"
          />
          <LinePath
            data={indices}
            defined={has(d.mean)}
            x={(i) => x(i)}
            y={at(d.mean)}
            stroke="var(--series-observed)"
            strokeWidth={kind === "daily" && days.length > 400 ? 1 : 1.5}
            strokeLinejoin="round"
            fill="none"
          />
          {day >= 0 && (
            <g className="price-marked" pointerEvents="none">
              <line
                x1={x(day)}
                x2={x(day)}
                y1={MARGIN.top}
                y2={BOTTOM}
                stroke="var(--ink)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              {dayMean !== null && (
                <circle
                  cx={x(day)}
                  cy={y(dayMean)}
                  r={4}
                  fill="var(--ink)"
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              )}
            </g>
          )}
          {anchor !== null && hovered !== null && (
            <Selection
              from={anchor}
              to={hovered}
              x={x}
              top={MARGIN.top}
              bottom={BOTTOM}
            />
          )}
          {hovered !== null && (
            <g pointerEvents="none">
              <line
                x1={x(hovered)}
                x2={x(hovered)}
                y1={MARGIN.top}
                y2={BOTTOM}
                stroke="var(--ink-2)"
              />
              {mean !== null && (
                <circle
                  cx={x(hovered)}
                  cy={y(mean)}
                  r={4}
                  fill="var(--series-observed)"
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              )}
            </g>
          )}
        </svg>
        {hovered !== null && (
          <Tooltip
            title={
              kind === "daily"
                ? (days[hovered] ?? "")
                : `${prices.days} days to ${days[hovered]}`
            }
            at={x(hovered) / WIDTH}
            rows={readout(d, hovered, false)}
          />
        )}
      </div>
    </div>
  );
}

interface Buckets {
  count: number;
  tick: (i: number) => string;
  title: (i: number) => string;
  /** The buckets labelled on narrow screens; every one is labelled on wide. */
  sparse: number[];
  axis: string;
  described: string;
}

/** The hero chart's profile buckets, labelled as it labels them. */
const BUCKETS: Record<PriceProfile["by"], Buckets> = {
  weekday: {
    count: 7,
    tick: (i) => WEEKDAYS[i]?.slice(0, 3) ?? "",
    title: (i) => WEEKDAYS[i] ?? "",
    sparse: [0, 1, 2, 3, 4, 5, 6],
    axis: "Weekday",
    described: "by weekday, Monday to Sunday",
  },
  period: {
    count: 24,
    tick: (i) => String(i + 1),
    title: (i) => `Period ${i + 1}`,
    sparse: [0, 5, 11, 17, 23],
    axis: "Period",
    described: "by period ordinal 1 to 24",
  },
};

/** The widest box: narrow enough that the first one clears the y labels. */
const MAX_BOX = 18;

interface ProfileProps {
  prices: PriceProfile;
  /** Whether the minimum and maximum are drawn beyond the whiskers. */
  extremes: boolean;
}

export function PriceProfileChart({ prices, extremes }: ProfileProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { distribution: d } = prices;
  const buckets = BUCKETS[prices.by];
  const last = buckets.count - 1;
  const indices = Array.from({ length: buckets.count }, (_, i) => i);

  // The hero chart's profile x scale, so the buckets line up with its points.
  const x = scaleLinear({
    domain: [0, last],
    range: [MARGIN.left, WIDTH - MARGIN.right],
  });
  const y = priceScale(d, extremes);
  const columnWidth = (WIDTH - MARGIN.left - MARGIN.right) / last;
  const half = Math.min(columnWidth * 0.55, MAX_BOX) / 2;
  const axis = (tickValues: number[], fontSize: number) => (
    <AxisBottom
      scale={x}
      top={BOTTOM}
      tickValues={tickValues}
      tickFormat={(i) => buckets.tick(Number(i))}
      stroke="var(--axis)"
      tickStroke="var(--axis)"
      tickLength={4}
      tickLabelProps={{ ...TICK_LABEL, fontSize }}
    />
  );

  return (
    <div className="chart-frame">
      <div className="chart">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`The observed price over the ${SCOPE_LABELS[
            prices.history
          ].toLowerCase()}, ${buckets.described}: its median, mean, 25–75% and 10–90% ranges${
            extremes ? ", minimum and maximum" : ""
          }, in EUR/MWh.`}
          onMouseLeave={() => setHovered(null)}
        >
          <PriceAxis y={y} />
          <Group className="ticks-dense">{axis(indices, 11)}</Group>
          <Group className="ticks-sparse">{axis(buckets.sparse, 14)}</Group>
          <text x={WIDTH - MARGIN.right + 12} y={BOTTOM + 18} {...TICK_LABEL}>
            {buckets.axis}
          </text>
          {indices.map((i) => {
            const [p10, q1, median, q3, p90, mean] = [
              d.p10[i],
              d.q1[i],
              d.median[i],
              d.q3[i],
              d.p90[i],
              d.mean[i],
            ];
            if (
              p10 == null ||
              q1 == null ||
              median == null ||
              q3 == null ||
              p90 == null ||
              mean == null
            )
              return null;
            const cx = x(i);
            const low = d.min[i] ?? null;
            const high = d.max[i] ?? null;
            return (
              <Group key={i}>
                {extremes && low !== null && high !== null && (
                  <g className="extremes">
                    <line
                      x1={cx}
                      x2={cx}
                      y1={y(low)}
                      y2={y(high)}
                      stroke="var(--muted)"
                      strokeDasharray="2 3"
                    />
                    {[low, high].map((v, end) => (
                      <line
                        key={end}
                        x1={cx - half / 2}
                        x2={cx + half / 2}
                        y1={y(v)}
                        y2={y(v)}
                        stroke="var(--muted)"
                      />
                    ))}
                  </g>
                )}
                <line
                  x1={cx}
                  x2={cx}
                  y1={y(p10)}
                  y2={y(p90)}
                  stroke="var(--ink-2)"
                />
                <rect
                  x={cx - half}
                  y={y(q3)}
                  width={2 * half}
                  height={Math.max(y(q1) - y(q3), 1)}
                  rx={2}
                  fill="var(--price-box)"
                  stroke="var(--ink-2)"
                />
                <line
                  x1={cx - half}
                  x2={cx + half}
                  y1={y(median)}
                  y2={y(median)}
                  stroke="var(--series-observed)"
                  strokeWidth={2}
                />
                <circle
                  cx={cx}
                  cy={y(mean)}
                  r={3}
                  fill="var(--series-observed)"
                  stroke="var(--surface)"
                  strokeWidth={1.5}
                />
              </Group>
            );
          })}
          {indices.map((i) => (
            <rect
              key={i}
              data-bucket={i}
              x={x(i) - columnWidth / 2}
              y={MARGIN.top}
              width={columnWidth}
              height={BOTTOM - MARGIN.top}
              fill="transparent"
              onMouseEnter={() => setHovered(i)}
            />
          ))}
        </svg>
        {hovered !== null && (
          <Tooltip
            title={buckets.title(hovered)}
            at={x(hovered) / WIDTH}
            rows={readout(d, hovered, true)}
          />
        )}
      </div>
    </div>
  );
}

/** The folded price chart's preview: the mean the chart would draw, as one
 * line with no axes, so the folded bar reads as a chart to open. */
export function PriceSparkline({ values }: { values: (number | null)[] }) {
  const width = 112;
  const height = 24;
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return null;
  const x = scaleLinear({
    domain: [0, values.length - 1],
    range: [1, width - 1],
  });
  const y = scaleLinear({
    domain: [Math.min(...known), Math.max(...known)],
    range: [height - 2, 2],
  });
  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <LinePath
        data={values.map((_, i) => i)}
        defined={(i) => values[i] !== null}
        x={(i) => x(i)}
        y={(i) => y(values[i] ?? 0)}
        stroke="var(--series-observed)"
        strokeWidth={1.25}
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
