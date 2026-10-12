/**
 * The hero chart's two metric views, across every scored delivery day:
 *
 * - **Over time** — the running metric (ADR-0007). Each point is the metric
 *   over every delivery period from 2020-01-01 up to that day, so the line is
 *   a whole-record figure settling, not a day being scored.
 * - **30 days** — the trailing metric (ADR-0017). Each point is the metric
 *   over the 30 delivery days ending on that day, so the line moves with how
 *   the models are doing now, and the first 29 days have no point.
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
import { useState, type MouseEvent } from "react";

import { EndMarker, TICK_LABEL, Tooltip, YGrid } from "./ChartParts.tsx";
import { formatTick, paddedDomain, spreadLabels } from "./charts.ts";
import {
  formatMetric,
  METRIC_PRESENTATION,
  MODEL_LABELS,
  SERIES_COLOURS,
  SERIES_DASH,
} from "./presentation.ts";
import { yearStarts } from "./record.ts";

const WIDTH = 960;
const HEIGHT = 340;
const MARGIN = { top: 26, right: 96, bottom: 30, left: 48 };
/** The running metric's first weeks swing wildly on a handful of periods;
 * they are drawn, but do not set the scale, or the settled record would be a
 * flat line. The trailing metric starts on a whole window and needs no such
 * guard. */
const SCALE_FROM_DAY = { running: 30, trailing: 0 };

export function OverTimeChart({ series }: { series: MetricOverTime }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { kind, metric } = series;
  const days = series.deliveryDates;
  const last = Math.max(days.length - 1, 1);

  const x = scaleLinear({
    domain: [0, last],
    range: [MARGIN.left, WIDTH - MARGIN.right],
  });
  const scaled = series.series.flatMap((s) =>
    s.values.slice(SCALE_FROM_DAY[kind]).filter((v): v is number => v !== null),
  );
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
      : `${metricLabel} over the trailing 30 days`;

  function track(event: MouseEvent<SVGSVGElement>): void {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    const position = ((event.clientX - box.left) / box.width) * WIDTH;
    const index = Math.round(x.invert(position));
    setHovered(Math.max(0, Math.min(last, index)));
  }

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
          onMouseMove={track}
          onMouseLeave={() => setHovered(null)}
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
          {yearStarts(days).map(({ index, year }) => (
            <Group key={year}>
              <line
                x1={x(index)}
                x2={x(index)}
                y1={MARGIN.top}
                y2={bottom + 4}
                stroke="var(--grid)"
              />
              <text x={x(index) + 4} y={bottom + 18} {...TICK_LABEL}>
                {year}
              </text>
            </Group>
          ))}
          <line
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={bottom}
            y2={bottom}
            stroke="var(--axis)"
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
                : `30 days to ${days[hovered]}`
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
