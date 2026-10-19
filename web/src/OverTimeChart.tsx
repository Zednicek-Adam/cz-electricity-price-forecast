/**
 * The hero chart's Over time view, across every scored delivery day, in either
 * position of its history switch (ADR-0018):
 *
 * - **Whole record** — the running metric (ADR-0007). Each point is the metric
 *   over every delivery period from 2020-01-01 up to that day, so the line is
 *   a whole-record figure settling, not a day being scored.
 * - **Last 30 days** and **Last 7 days** — the trailing metric (ADR-0017,
 *   ADR-0018). Each point is the metric over the 30 or 7 delivery days ending
 *   on that day, so the line moves with how the models are doing now, and the
 *   first 29 or 6 days have no point.
 *
 * Both draw the zoom the price chart shares (ADR-0019): a drag across the
 * chart zooms both to the days it covered, and the y axis fits the days
 * drawn.
 *
 * There is no observed line: on a metric axis the observed price is the zero
 * the metric is measured from. Every point is drawn, as SVG, with no
 * downsampling (ADR-0009). If crosshair tracking ever visibly lags here, the
 * named fix is to memoize the path strings in this file.
 */
import type { MetricOverTime } from "./types.ts";
import { AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";

import {
  EndMarker,
  TICK_LABEL,
  TimeAxis,
  Tooltip,
  YGrid,
} from "./ChartParts.tsx";
import { formatTick, paddedDomain, spreadLabels } from "./charts.ts";
import {
  formatMetric,
  METRIC_PRESENTATION,
  MODEL_LABELS,
  SERIES_COLOURS,
  SERIES_DASH,
} from "./presentation.ts";
import { Selection, useDragZoom, zoomRange, type Zoom } from "./Zoom.tsx";

const WIDTH = 960;
const HEIGHT = 340;
const MARGIN = { top: 26, right: 96, bottom: 30, left: 48 };
/** The running metric's first weeks swing wildly on a handful of periods;
 * they are drawn, but do not set the scale, or the settled record would be a
 * flat line. The trailing metric starts on a whole window and needs no such
 * guard. */
const SCALE_FROM_DAY = { running: 30, trailing: 0 };

interface Props {
  series: MetricOverTime;
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
}

export function OverTimeChart({ series: whole, zoom, onZoom }: Props) {
  const { kind, metric } = whole;
  // The zoomed days, and every series cut to them.
  const [start, end] = zoomRange(whole.deliveryDates, zoom);
  const days = whole.deliveryDates.slice(start, end + 1);
  const series = {
    ...whole,
    series: whole.series.map((s) => ({
      ...s,
      values: s.values.slice(start, end + 1),
    })),
  };
  const last = Math.max(days.length - 1, 1);

  const x = scaleLinear({
    domain: [0, last],
    range: [MARGIN.left, WIDTH - MARGIN.right],
  });
  const values = (from: number) =>
    series.series.flatMap((s) =>
      s.values.slice(from).filter((v): v is number => v !== null),
    );
  const skipped = values(Math.max(0, SCALE_FROM_DAY[kind] - start));
  const scaled = skipped.length ? skipped : values(0);
  const y = scaleLinear({
    domain: paddedDomain(scaled.length ? scaled : [0, 1], 0.12),
    range: [HEIGHT - MARGIN.bottom, MARGIN.top],
    clamp: true,
    nice: true,
  });
  const ticks = y.ticks(5);
  const lastValue = (values: (number | null)[]) => values.at(-1) ?? null;
  const labelY = spreadLabels(
    series.series.map((s) => y(lastValue(s.values) ?? 0) + 4),
    14,
  );
  const { label: metricLabel, unit } = METRIC_PRESENTATION[metric];
  const bottom = HEIGHT - MARGIN.bottom;
  const described =
    kind === "running"
      ? `Running ${metricLabel}`
      : `${metricLabel} over the trailing ${series.days} days`;

  function indexAt(fraction: number): number {
    const index = Math.round(x.invert(fraction * WIDTH));
    return Math.max(0, Math.min(days.length - 1, index));
  }
  const { hovered, anchor, handlers } = useDragZoom(days, indexAt, onZoom);

  return (
    <div className="chart-frame">
      <div className="chart">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${described} of ${series.series
            .map((s) => MODEL_LABELS[s.model])
            .join(", ")}, over every delivery day from ${days[0] ?? ""} to ${
            days.at(-1) ?? ""
          }.`}
          className="zoomable"
          {...handlers}
        >
          <text x={4} y={12} {...TICK_LABEL}>
            {unit ? `${metricLabel} · ${unit}` : metricLabel}
          </text>
          <YGrid
            ticks={ticks}
            y={y}
            left={MARGIN.left}
            right={WIDTH - MARGIN.right}
          />
          <TimeAxis
            days={days}
            x={x}
            top={MARGIN.top}
            bottom={bottom}
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
            tickLabelProps={TICK_LABEL}
          />
          {series.series.map((s, index) => {
            const end = lastValue(s.values);
            return (
              <Group key={s.model}>
                <LinePath
                  data={s.values}
                  defined={(v) => v !== null}
                  x={(_, i) => x(i)}
                  y={(v) => y(v ?? 0)}
                  stroke={SERIES_COLOURS[s.model]}
                  strokeWidth={kind === "trailing" ? 1.5 : 2}
                  strokeDasharray={SERIES_DASH[s.model]}
                  strokeLinejoin="round"
                  fill="none"
                />
                {end !== null && (
                  <EndMarker
                    series={s.model}
                    label={MODEL_LABELS[s.model]}
                    x={x(last)}
                    y={y(end)}
                    labelY={labelY[index] as number}
                  />
                )}
              </Group>
            );
          })}
          {anchor !== null && hovered !== null && (
            <Selection
              from={anchor}
              to={hovered}
              x={x}
              top={MARGIN.top}
              bottom={bottom}
            />
          )}
          {hovered !== null && (
            <g pointerEvents="none">
              <line
                x1={x(hovered)}
                x2={x(hovered)}
                y1={MARGIN.top}
                y2={bottom}
                stroke="var(--ink-2)"
              />
              {series.series.map((s) => {
                const value = s.values[hovered] ?? null;
                return (
                  value !== null && (
                    <circle
                      key={s.model}
                      cx={x(hovered)}
                      cy={y(value)}
                      r={4}
                      fill={SERIES_COLOURS[s.model]}
                      stroke="var(--surface)"
                      strokeWidth={2}
                    />
                  )
                );
              })}
            </g>
          )}
        </svg>
        {hovered !== null && (
          <Tooltip
            title={
              kind === "running"
                ? `Through ${days[hovered]}`
                : `${series.days} days to ${days[hovered]}`
            }
            at={x(hovered) / WIDTH}
            rows={series.series.map((s) => ({
              series: s.model,
              label: MODEL_LABELS[s.model],
              value: formatMetric(metric, s.values[hovered] ?? null),
            }))}
          />
        )}
      </div>
    </div>
  );
}
