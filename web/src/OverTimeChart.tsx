/**
 * The hero chart's Over time view: the running metric for every model across
 * every replayed delivery day (ADR-0007). Each point is the metric over every
 * delivery period from 2020-01-01 up to that day, so the line is a
 * whole-record figure settling, not a day being scored. There is no observed
 * line: on a metric axis the observed price is the zero the metric is measured
 * from.
 *
 * Every point is drawn, as SVG, with no downsampling (ADR-0009). If crosshair
 * tracking ever visibly lags here, the named fix is to memoize the path
 * strings in this file.
 */
import type { Metric, RunningMetricResponse } from "@cz-epf/api";
import { AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { useState, type MouseEvent } from "react";

import { paddedDomain, spreadLabels } from "./charts.ts";
import {
  formatMetric,
  METRIC_PRESENTATION,
  MODEL_LABELS,
  SERIES_COLOURS,
} from "./presentation.ts";
import { yearStarts } from "./record.ts";

const WIDTH = 960;
const HEIGHT = 360;
const MARGIN = { top: 14, right: 84, bottom: 30, left: 52 };
/** The first weeks swing wildly on a handful of periods; they are drawn, but
 * do not set the scale, or the settled record would be a flat line. */
const SCALE_FROM_DAY = 30;

interface Props {
  metric: Metric;
  running: RunningMetricResponse;
}

export function OverTimeChart({ metric, running }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  const days = running.deliveryDates;
  const last = Math.max(days.length - 1, 1);

  const x = scaleLinear({
    domain: [0, last],
    range: [MARGIN.left, WIDTH - MARGIN.right],
  });
  const scaled = running.series.flatMap((s) =>
    s.values.slice(SCALE_FROM_DAY).filter((v): v is number => v !== null),
  );
  const y = scaleLinear({
    domain: paddedDomain(scaled.length ? scaled : [0, 1], 0.15),
    range: [HEIGHT - MARGIN.bottom, MARGIN.top],
    clamp: true,
  });
  const labelY = spreadLabels(
    running.series.map((s) => y(s.values.at(-1) ?? 0) + 4),
  );
  const { label: metricLabel } = METRIC_PRESENTATION[metric];

  function track(event: MouseEvent<SVGSVGElement>): void {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    const position = ((event.clientX - box.left) / box.width) * WIDTH;
    const index = Math.round(x.invert(position));
    setHovered(Math.max(0, Math.min(last, index)));
  }

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Running ${metricLabel} of ${running.series
          .map((s) => MODEL_LABELS[s.model])
          .join(", ")}, over every delivery day from ${days[0] ?? ""} to ${
          days.at(-1) ?? ""
        }.`}
        onMouseMove={track}
        onMouseLeave={() => setHovered(null)}
      >
        {yearStarts(days).map(({ index, year }) => (
          <Group key={year}>
            <line
              x1={x(index)}
              x2={x(index)}
              y1={MARGIN.top}
              y2={HEIGHT - MARGIN.bottom}
              stroke="var(--grid)"
            />
            <text
              x={x(index) + 4}
              y={HEIGHT - 10}
              fontSize={11}
              fill="var(--muted)"
            >
              {year}
            </text>
          </Group>
        ))}
        <AxisLeft
          scale={y}
          left={MARGIN.left}
          numTicks={5}
          stroke="var(--axis)"
          tickStroke="var(--axis)"
          tickFormat={(v) => formatMetric(metric, Number(v))}
          tickLabelProps={{ fill: "var(--muted)", fontSize: 11 }}
        />
        {running.series.map((s, index) => (
          <Group key={s.model}>
            <LinePath
              data={s.values}
              defined={(v) => v !== null}
              x={(_, i) => x(i)}
              y={(v) => y(v ?? 0)}
              stroke={SERIES_COLOURS[s.model]}
              strokeWidth={2}
              strokeDasharray={s.model === "daylag" ? "5 4" : undefined}
              strokeLinejoin="round"
              fill="none"
            />
            <text
              x={WIDTH - MARGIN.right + 6}
              y={labelY[index]}
              fill={SERIES_COLOURS[s.model]}
              fontSize={11}
              fontWeight={600}
            >
              {MODEL_LABELS[s.model]}
            </text>
          </Group>
        ))}
        {hovered !== null && (
          <line
            x1={x(hovered)}
            x2={x(hovered)}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
            stroke="var(--ink-2)"
          />
        )}
      </svg>
      {hovered !== null && (
        <div
          aria-hidden="true"
          className={hovered > last / 2 ? "tooltip tooltip-left" : "tooltip"}
          style={{ left: `${(x(hovered) / WIDTH) * 100}%` }}
        >
          <div className="tooltip-title">Through {days[hovered]}</div>
          {running.series.map((s) => (
            <div key={s.model} className="tooltip-row">
              <span
                className="swatch"
                style={{ background: SERIES_COLOURS[s.model] }}
              />
              <span>{MODEL_LABELS[s.model]}</span>
              <span className="figure">
                {formatMetric(metric, s.values[hovered] ?? null)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
