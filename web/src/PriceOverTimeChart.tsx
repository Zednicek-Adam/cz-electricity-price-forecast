/**
 * Electricity price over time across scored delivery days:
 * - Whole record: running average price from the first delivery day
 * - Last 30 / 7 days: trailing average price over that window
 *
 * Visx primitives only, fluid viewBox, matching the OverTimeChart's geometry.
 */
import { AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { useState, type MouseEvent } from "react";

import { EndMarker, TICK_LABEL, Tooltip, YGrid } from "./ChartParts.tsx";
import { formatTick, paddedDomain } from "./charts.ts";
import { formatDay, formatPrice } from "./presentation.ts";
import type { PriceOverTime } from "./price.ts";
import { yearStarts } from "./record.ts";

const WIDTH = 960;
const HEIGHT = 280;
const MARGIN = { top: 26, right: 96, bottom: 30, left: 48 };

export function PriceOverTimeChart({ overTime }: { overTime: PriceOverTime }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { kind, days, deliveryDates, values, dailyMeans } = overTime;
  const last = Math.max(deliveryDates.length - 1, 1);

  const x = scaleLinear({
    domain: [0, last],
    range: [MARGIN.left, WIDTH - MARGIN.right],
  });

  const validValues = values.filter((v): v is number => v !== null);
  const validDaily = dailyMeans.filter((v): v is number => v !== null);
  const allY = [...validValues, ...validDaily];

  const y = scaleLinear({
    domain: paddedDomain(allY.length ? allY : [0, 100], 0.12),
    range: [HEIGHT - MARGIN.bottom, MARGIN.top],
    nice: true,
  });

  const ticks = y.ticks(5);
  const bottom = HEIGHT - MARGIN.bottom;
  const lastValue = values.at(-1) ?? null;

  const seriesLabel =
    kind === "running" ? "Running mean" : `Trailing ${days}-day mean`;

  function track(event: MouseEvent<SVGSVGElement>): void {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    const position = ((event.clientX - box.left) / box.width) * WIDTH;
    const index = Math.round(x.invert(position));
    setHovered(Math.max(0, Math.min(last, index)));
  }

  const hoveredDate =
    hovered !== null ? (deliveryDates[hovered] ?? null) : null;
  const hoveredValue = hovered !== null ? (values[hovered] ?? null) : null;
  const hoveredDaily = hovered !== null ? (dailyMeans[hovered] ?? null) : null;

  return (
    <div className="chart-frame">
      <div className="chart">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`Electricity price over time: ${seriesLabel.toLowerCase()} from ${
            deliveryDates[0] ?? ""
          } to ${deliveryDates.at(-1) ?? ""}.`}
          onMouseMove={track}
          onMouseLeave={() => setHovered(null)}
        >
          <text x={4} y={12} {...TICK_LABEL}>
            EUR/MWh
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
          {yearStarts(deliveryDates).map(({ index, year }) => (
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

          {/* Daily mean price (subtle background line) */}
          <LinePath
            data={dailyMeans}
            defined={(v) => v !== null}
            x={(_, i) => x(i)}
            y={(v) => y(v ?? 0)}
            stroke="rgba(17, 17, 16, 0.22)"
            strokeWidth={1}
            fill="none"
          />

          {/* Running / Trailing mean line (solid primary) */}
          <LinePath
            data={values}
            defined={(v) => v !== null}
            x={(_, i) => x(i)}
            y={(v) => y(v ?? 0)}
            stroke="var(--ink)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />

          {/* End marker */}
          {lastValue !== null && (
            <EndMarker
              series="observed"
              label={seriesLabel}
              x={x(last)}
              y={y(lastValue)}
              labelY={y(lastValue) + 4}
            />
          )}

          {/* Hover crosshair and dot */}
          {hovered !== null && typeof hoveredValue === "number" && (
            <g pointerEvents="none">
              <line
                x1={x(hovered)}
                x2={x(hovered)}
                y1={MARGIN.top}
                y2={bottom}
                stroke="var(--ink-2)"
              />
              <circle
                cx={x(hovered)}
                cy={y(hoveredValue)}
                r={4}
                fill="var(--ink)"
                stroke="var(--surface)"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>

        {hovered !== null && hoveredDate && (
          <Tooltip
            title={formatDay(hoveredDate)}
            at={x(hovered) / WIDTH}
            rows={[
              ...(typeof hoveredValue === "number"
                ? [
                    {
                      series: "observed" as const,
                      label: seriesLabel,
                      value: `${formatPrice(hoveredValue)} EUR/MWh`,
                    },
                  ]
                : []),
              ...(typeof hoveredDaily === "number"
                ? [
                    {
                      series: "observed" as const,
                      label: "Daily mean",
                      value: `${formatPrice(hoveredDaily)} EUR/MWh`,
                    },
                  ]
                : []),
            ]}
          />
        )}
      </div>
    </div>
  );
}
