/**
 * The ribbon: the selected metric for the headline model on every replayed
 * delivery day, as one continuous filled area beneath the Day view. It is a
 * control, not a picture — clicking it jumps the Day view to that day
 * (ADR-0007).
 *
 * It is `aria-hidden` and keyboard-inert on purpose: the date stepper and the
 * worst / best / random buttons duplicate its picker function as native
 * controls, and 1,827 points announced one by one would be noise (ADR-0009).
 * Each day has an invisible column under one delegated click handler, so the
 * pointer maps to a day without layout arithmetic.
 */
import type { DailyMetricResponse, DeliveryDate } from "@cz-epf/api";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import type { MouseEvent } from "react";

import { SERIES_COLOURS } from "./presentation.ts";
import { yearStarts } from "./record.ts";

const WIDTH = 960;
const HEIGHT = 88;
const MARGIN = { top: 8, right: 6, bottom: 16, left: 6 };

interface Props {
  daily: DailyMetricResponse;
  selected: DeliveryDate;
  onPick: (day: DeliveryDate) => void;
}

export function Ribbon({ daily, selected, onPick }: Props) {
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

  function pick(event: MouseEvent<SVGGElement>): void {
    const day = (event.target as Element).getAttribute("data-day");
    if (day) onPick(day);
  }

  return (
    <div className="chart ribbon" aria-hidden="true">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        {yearStarts(days).map(({ index, year }) => (
          <Group key={year}>
            <line
              x1={x(index)}
              x2={x(index)}
              y1={MARGIN.top}
              y2={HEIGHT - MARGIN.bottom}
              stroke="var(--axis)"
            />
            <text
              x={x(index) + 4}
              y={HEIGHT - 4}
              fontSize={10}
              fill="var(--muted)"
            >
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
          fillOpacity={0.16}
        />
        <LinePath
          data={daily.values}
          x={(_, i) => x(i)}
          y={(v) => y(v)}
          stroke={colour}
          strokeWidth={1}
          fill="none"
        />
        {at >= 0 && (
          <line
            x1={x(at)}
            x2={x(at)}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
            stroke="var(--ink)"
            strokeWidth={2}
          />
        )}
        <g onClick={pick} style={{ cursor: "pointer" }}>
          {days.map((day, i) => (
            <rect
              key={day}
              data-day={day}
              x={x(i) - column / 2}
              y={MARGIN.top}
              width={column}
              height={HEIGHT - MARGIN.top - MARGIN.bottom}
              fill="transparent"
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
