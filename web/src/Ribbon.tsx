/**
 * The ribbon: the selected metric for the headline model on every scored
 * delivery day, as one continuous filled area beneath the Day view. It is a
 * control, not a picture — clicking it jumps the Day view to that day
 * (ADR-0007). Hovering reads out the day under the pointer, so the jump is
 * never blind.
 *
 * It is `aria-hidden` and keyboard-inert on purpose: the date stepper and the
 * worst / best / random buttons duplicate its picker function as native
 * controls, and thousands of points announced one by one would be noise
 * (ADR-0009). Each day has an invisible column under one delegated handler,
 * so the pointer maps to a day without layout arithmetic.
 */
import type { DailyMetric, DeliveryDate } from "./types.ts";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { useState, type MouseEvent } from "react";

import { TICK_LABEL } from "./ChartParts.tsx";
import {
  formatDay,
  formatMetric,
  METRIC_PRESENTATION,
  SERIES_COLOURS,
} from "./presentation.ts";
import { yearStarts } from "./record.ts";

const WIDTH = 960;
const HEIGHT = 76;
const MARGIN = { top: 6, right: 4, bottom: 18, left: 4 };

interface Props {
  daily: DailyMetric;
  selected: DeliveryDate;
  onPick: (day: DeliveryDate) => void;
}

export function Ribbon({ daily, selected, onPick }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  const days = daily.deliveryDates;
  const last = Math.max(days.length - 1, 1);
  const x = scaleLinear({
    domain: [0, last],
    range: [MARGIN.left, WIDTH - MARGIN.right],
  });
  const y = scaleLinear({
    domain: [Math.min(0, ...daily.values), Math.max(...daily.values, 1)],
    range: [HEIGHT - MARGIN.bottom, MARGIN.top],
  });
  const column = (WIDTH - MARGIN.left - MARGIN.right) / (last + 1);
  const at = days.indexOf(selected);
  const colour = SERIES_COLOURS[daily.model];
  const bottom = HEIGHT - MARGIN.bottom;

  function dayOf(event: MouseEvent<SVGGElement>): string | null {
    return (event.target as Element).getAttribute("data-day");
  }

  function pick(event: MouseEvent<SVGGElement>): void {
    const day = dayOf(event);
    if (day) onPick(day);
  }

  function track(event: MouseEvent<SVGGElement>): void {
    const day = dayOf(event);
    setHovered(day ? days.indexOf(day) : null);
  }

  const hoveredValue = hovered === null ? undefined : daily.values[hovered];

  return (
    <div className="chart ribbon" aria-hidden="true">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <line
          x1={MARGIN.left}
          x2={WIDTH - MARGIN.right}
          y1={bottom}
          y2={bottom}
          stroke="var(--axis)"
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
            <text x={x(index) + 4} y={HEIGHT - 4} {...TICK_LABEL} fontSize={10}>
              {year}
            </text>
          </Group>
        ))}
        <AreaClosed
          data={daily.values}
          x={(_, i) => x(i)}
          y={(v) => y(v)}
          yScale={y}
          fill={colour}
          fillOpacity={0.12}
        />
        <LinePath
          data={daily.values}
          x={(_, i) => x(i)}
          y={(v) => y(v)}
          stroke={colour}
          strokeWidth={1}
          fill="none"
        />
        {hovered !== null && hovered !== at && (
          <line
            x1={x(hovered)}
            x2={x(hovered)}
            y1={MARGIN.top}
            y2={bottom}
            stroke="var(--muted)"
          />
        )}
        {at >= 0 && (
          <g className="ribbon-selected">
            <line
              x1={x(at)}
              x2={x(at)}
              y1={MARGIN.top}
              y2={bottom}
              stroke="var(--ink)"
              strokeWidth={2}
            />
            <circle
              cx={x(at)}
              cy={y(daily.values[at] as number)}
              r={4}
              fill="var(--ink)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </g>
        )}
        <g
          onClick={pick}
          onMouseMove={track}
          onMouseLeave={() => setHovered(null)}
          style={{ cursor: "pointer" }}
        >
          {days.map((day, i) => (
            <rect
              key={day}
              data-day={day}
              x={x(i) - column / 2}
              y={MARGIN.top}
              width={column}
              height={bottom - MARGIN.top}
              fill="transparent"
            />
          ))}
        </g>
      </svg>
      {hovered !== null && hoveredValue !== undefined && (
        <div
          className={
            x(hovered) / WIDTH > 0.6
              ? "tooltip tooltip-compact tooltip-left"
              : "tooltip tooltip-compact"
          }
          style={{ left: `${(x(hovered) / WIDTH) * 100}%` }}
        >
          <span className="tooltip-title">
            {formatDay(days[hovered] as string)}
          </span>{" "}
          <span className="figure">
            {formatMetric(daily.metric, hoveredValue)}
          </span>{" "}
          <span className="tooltip-muted">
            {METRIC_PRESENTATION[daily.metric].label}
          </span>
        </div>
      )}
    </div>
  );
}
