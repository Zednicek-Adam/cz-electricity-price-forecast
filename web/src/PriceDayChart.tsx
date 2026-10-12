/**
 * Electricity price on one delivery day across 24 period ordinals, EUR/MWh.
 * Matches DayChart's geometry and crosshair tracking.
 */
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { useState } from "react";

import { EndMarker, TICK_LABEL, Tooltip, YGrid } from "./ChartParts.tsx";
import { paddedDomain } from "./charts.ts";
import { formatPrice } from "./presentation.ts";
import type { PriceDay } from "./price.ts";

const WIDTH = 960;
const HEIGHT = 280;
const MARGIN = { top: 26, right: 96, bottom: 30, left: 48 };
const ORDINALS = Array.from({ length: 24 }, (_, i) => i + 1);

export function PriceDayChart({ day }: { day: PriceDay }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (!day.observed) {
    return (
      <p className="note">
        Not published yet: the price clears the day before delivery.
      </p>
    );
  }

  const prices = day.observed;
  const x = scaleLinear({
    domain: [1, 24],
    range: [MARGIN.left, WIDTH - MARGIN.right],
  });
  const y = scaleLinear({
    domain: paddedDomain(prices),
    range: [HEIGHT - MARGIN.bottom, MARGIN.top],
    nice: true,
  });

  const [low, high] = y.domain() as [number, number];
  const ticks = y.ticks(5);
  const bottom = HEIGHT - MARGIN.bottom;
  const columnWidth = (WIDTH - MARGIN.left - MARGIN.right) / 23;
  const lastPrice = prices.at(-1) as number;

  return (
    <div className="chart-frame">
      <div className="chart">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${day.deliveryDate}: observed electricity price, in EUR/MWh, by period ordinal 1 to 24.`}
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
          {low < 0 && high > 0 && (
            <line
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={y(0)}
              y2={y(0)}
              stroke="var(--axis)"
            />
          )}
          <AxisLeft
            scale={y}
            left={MARGIN.left}
            tickValues={ticks}
            hideAxisLine
            hideTicks
            tickLabelProps={TICK_LABEL}
          />
          <Group className="ticks-dense">
            <AxisBottom
              scale={x}
              top={bottom}
              tickValues={ORDINALS}
              tickFormat={(d) => String(d)}
              stroke="var(--axis)"
              tickStroke="var(--axis)"
              tickLength={4}
              tickLabelProps={{ ...TICK_LABEL, fontSize: 11 }}
            />
          </Group>
          <Group className="ticks-sparse">
            <AxisBottom
              scale={x}
              top={bottom}
              tickValues={[1, 6, 12, 18, 24]}
              tickFormat={(d) => String(d)}
              stroke="var(--axis)"
              tickStroke="var(--axis)"
              tickLength={4}
              tickLabelProps={{ ...TICK_LABEL, fontSize: 14 }}
            />
          </Group>
          <text x={WIDTH - MARGIN.right + 12} y={bottom + 18} {...TICK_LABEL}>
            Period
          </text>

          <LinePath
            data={prices}
            x={(_, i) => x(i + 1)}
            y={(v) => y(v)}
            stroke="var(--series-observed)"
            strokeWidth={2.4}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />

          <EndMarker
            series="observed"
            label="Observed"
            x={x(24)}
            y={y(lastPrice)}
            labelY={y(lastPrice) + 4}
          />

          {hovered !== null && (
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
                cy={y(prices[hovered - 1] as number)}
                r={4}
                fill="var(--series-observed)"
                stroke="var(--surface)"
                strokeWidth={2}
              />
            </g>
          )}

          {ORDINALS.map((ordinal) => (
            <rect
              key={ordinal}
              data-price-ordinal={ordinal}
              x={x(ordinal) - columnWidth / 2}
              y={MARGIN.top}
              width={columnWidth}
              height={bottom - MARGIN.top}
              fill="transparent"
              onMouseEnter={() => setHovered(ordinal)}
            />
          ))}
        </svg>

        {hovered !== null && (
          <Tooltip
            title={`Period ${hovered}`}
            at={x(hovered) / WIDTH}
            rows={[
              {
                series: "observed",
                label: "Observed",
                value: `${formatPrice(prices[hovered - 1] as number)} EUR/MWh`,
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}
