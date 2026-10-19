/**
 * The hero chart's two profile views, over the whole record or the last 30 or
 * 7 days (ADR-0018):
 *
 * - **By weekday** — each model's metric on the delivery days of each weekday,
 *   Monday to Sunday.
 * - **By hour** — each model's metric at each of the 24 period ordinals.
 *
 * Each point pools every delivery period in its bucket, as the export
 * computed it. The x axis is categorical, so the crosshair tracks one
 * invisible column per bucket, as the Day view does; a CSS breakpoint swaps
 * the period ticks' density. There is no observed line, for the same reason
 * as in the Over time view.
 */
import type { MetricProfile } from "./types.ts";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { useState } from "react";

import { EndMarker, TICK_LABEL, Tooltip, YGrid } from "./ChartParts.tsx";
import { formatTick, paddedDomain, spreadLabels } from "./charts.ts";
import {
  formatMetric,
  METRIC_PRESENTATION,
  MODEL_LABELS,
  SCOPE_LABELS,
  SERIES_COLOURS,
  SERIES_DASH,
  WEEKDAYS,
} from "./presentation.ts";

const WIDTH = 960;
const HEIGHT = 340;
const MARGIN = { top: 26, right: 96, bottom: 30, left: 48 };

interface Buckets {
  count: number;
  /** The tick label under bucket `i`, counting from 0. */
  tick: (i: number) => string;
  /** The tooltip's title at bucket `i`. */
  title: (i: number) => string;
  /** The buckets labelled on narrow screens; every one is labelled on wide. */
  sparse: number[];
  axis: string;
  described: string;
}

const BUCKETS: Record<MetricProfile["by"], Buckets> = {
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

export function ProfileChart({ profile }: { profile: MetricProfile }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { metric } = profile;
  const buckets = BUCKETS[profile.by];
  const last = buckets.count - 1;
  const indices = Array.from({ length: buckets.count }, (_, i) => i);

  const x = scaleLinear({
    domain: [0, last],
    range: [MARGIN.left, WIDTH - MARGIN.right],
  });
  const values = profile.series.flatMap((s) =>
    s.values.filter((v): v is number => v !== null),
  );
  const y = scaleLinear({
    domain: paddedDomain(values.length ? values : [0, 1], 0.12),
    range: [HEIGHT - MARGIN.bottom, MARGIN.top],
    nice: true,
  });
  const ticks = y.ticks(5);
  const lastValue = (v: (number | null)[]) => v.at(-1) ?? null;
  const labelY = spreadLabels(
    profile.series.map((s) => y(lastValue(s.values) ?? 0) + 4),
    14,
  );
  const { label: metricLabel, unit } = METRIC_PRESENTATION[metric];
  const bottom = HEIGHT - MARGIN.bottom;
  const columnWidth = (WIDTH - MARGIN.left - MARGIN.right) / last;
  const axis = (tickValues: number[], fontSize: number) => (
    <AxisBottom
      scale={x}
      top={bottom}
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
          aria-label={`${metricLabel} of ${profile.series
            .map((s) => MODEL_LABELS[s.model])
            .join(", ")} over the ${SCOPE_LABELS[
            profile.scope
          ].toLowerCase()}, ${buckets.described}.`}
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
          <AxisLeft
            scale={y}
            left={MARGIN.left}
            tickValues={ticks}
            hideAxisLine
            hideTicks
            tickFormat={(v) => formatTick(Number(v))}
            tickLabelProps={TICK_LABEL}
          />
          <Group className="ticks-dense">{axis(indices, 11)}</Group>
          <Group className="ticks-sparse">{axis(buckets.sparse, 14)}</Group>
          <text x={WIDTH - MARGIN.right + 12} y={bottom + 18} {...TICK_LABEL}>
            {buckets.axis}
          </text>
          {profile.series.map((s, index) => {
            const end = lastValue(s.values);
            return (
              <Group key={s.model}>
                <LinePath
                  data={s.values}
                  defined={(v) => v !== null}
                  x={(_, i) => x(i)}
                  y={(v) => y(v ?? 0)}
                  stroke={SERIES_COLOURS[s.model]}
                  strokeWidth={2}
                  strokeDasharray={SERIES_DASH[s.model]}
                  strokeLinejoin="round"
                  strokeLinecap="round"
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
              {profile.series.map((s) => {
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
          {indices.map((i) => (
            <rect
              key={i}
              data-bucket={i}
              x={x(i) - columnWidth / 2}
              y={MARGIN.top}
              width={columnWidth}
              height={bottom - MARGIN.top}
              fill="transparent"
              onMouseEnter={() => setHovered(i)}
            />
          ))}
        </svg>
        {hovered !== null && (
          <Tooltip
            title={buckets.title(hovered)}
            at={x(hovered) / WIDTH}
            rows={profile.series.map((s) => ({
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
