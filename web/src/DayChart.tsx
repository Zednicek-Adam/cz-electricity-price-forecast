/**
 * The hero chart's Day view: the observed price against every model over the
 * 24 period ordinals of one delivery day, EUR/MWh (ADR-0007). No metric
 * changes it: the metric selector in the Day view rescores the day beneath
 * the chart, never the prices on it (ADR-0017).
 *
 * visx primitives only — scale, shape, axis, group — and every pointer event
 * is ours (ADR-0009). The crosshair tracks 24 invisible columns, one per
 * period ordinal, so hovering needs no geometry arithmetic. The tooltip is a
 * hand-positioned `div`. Width is fluid through `viewBox`; a CSS breakpoint
 * swaps the tick density.
 *
 * Daylight-saving days are drawn on the repaired 24-period grid like any
 * other, with no note, and negative prices are drawn as they cleared. The
 * pending day has no observed line: its price is not published yet.
 */
import type { DeliveryDay, ModelSlug } from "./types.ts";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { useState } from "react";

import { EndMarker, TICK_LABEL, Tooltip, YGrid } from "./ChartParts.tsx";
import { paddedDomain, spreadLabels } from "./charts.ts";
import { seriesLabel } from "./Legend.tsx";
import { formatPrice, SERIES_COLOURS, SERIES_DASH } from "./presentation.ts";

const WIDTH = 960;
const HEIGHT = 340;
const MARGIN = { top: 26, right: 96, bottom: 30, left: 48 };
const ORDINALS = Array.from({ length: 24 }, (_, i) => i + 1);

interface Series {
  key: ModelSlug | "observed";
  label: string;
  prices: number[];
}

export function DayChart({ day }: { day: DeliveryDay }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const series: Series[] = [
    ...(day.observed
      ? [{ key: "observed" as const, label: "Observed", prices: day.observed }]
      : []),
    ...day.forecasts.map((f) => ({
      key: f.model,
      label: seriesLabel(f.model),
      prices: f.prices,
    })),
  ];
  for (const s of series) {
    if (s.prices.length !== 24) {
      throw new Error(`${day.deliveryDate}: ${s.prices.length} prices, not 24`);
    }
  }
  const all = series.flatMap((s) => s.prices);
  const x = scaleLinear({
    domain: [1, 24],
    range: [MARGIN.left, WIDTH - MARGIN.right],
  });
  const y = scaleLinear({
    domain: paddedDomain(all.length ? all : [0, 1]),
    range: [HEIGHT - MARGIN.bottom, MARGIN.top],
    nice: true,
  });
  const [low, high] = y.domain() as [number, number];
  const ticks = y.ticks(5);
  const end = (s: Series) => y(s.prices.at(-1) as number);
  const labelY = spreadLabels(
    series.map((s) => end(s) + 4),
    14,
  );
  const columnWidth = (WIDTH - MARGIN.left - MARGIN.right) / 23;
  const forecasts = day.forecasts.map((f) => seriesLabel(f.model)).join(", ");
  const label = `${day.deliveryDate}: ${
    day.observed ? "the observed price and " : ""
  }the forecasts of ${forecasts}, in EUR/MWh, by period ordinal 1 to 24.`;
  const bottom = HEIGHT - MARGIN.bottom;

  return (
    <div className="chart-frame">
      <div className="chart">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={label}
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
              stroke="var(--axis)"
              tickStroke="var(--axis)"
              tickLength={4}
              tickLabelProps={TICK_LABEL}
            />
          </Group>
          <Group className="ticks-sparse">
            <AxisBottom
              scale={x}
              top={bottom}
              tickValues={[1, 6, 12, 18, 24]}
              stroke="var(--axis)"
              tickStroke="var(--axis)"
              tickLength={4}
              tickLabelProps={{ ...TICK_LABEL, fontSize: 14 }}
            />
          </Group>
          <text x={WIDTH - MARGIN.right + 12} y={bottom + 18} {...TICK_LABEL}>
            Period
          </text>
          {series.map((s, index) => (
            <Group key={s.key}>
              <LinePath
                data={s.prices}
                x={(_, i) => x(i + 1)}
                y={(price) => y(price)}
                stroke={SERIES_COLOURS[s.key]}
                strokeWidth={s.key === "observed" ? 2.75 : 2}
                strokeDasharray={SERIES_DASH[s.key]}
                strokeLinejoin="round"
                strokeLinecap="round"
                fill="none"
              />
              <EndMarker
                series={s.key}
                label={s.label}
                x={x(24)}
                y={end(s)}
                labelY={labelY[index] as number}
              />
            </Group>
          ))}
          {hovered !== null && (
            <g pointerEvents="none">
              <line
                className="crosshair"
                x1={x(hovered)}
                x2={x(hovered)}
                y1={MARGIN.top}
                y2={bottom}
                stroke="var(--ink-2)"
                strokeWidth={1}
              />
              {series.map((s) => (
                <circle
                  key={s.key}
                  cx={x(hovered)}
                  cy={y(s.prices[hovered - 1] as number)}
                  r={4}
                  fill={SERIES_COLOURS[s.key]}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ))}
            </g>
          )}
          {ORDINALS.map((ordinal) => (
            <rect
              key={ordinal}
              data-ordinal={ordinal}
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
            rows={series.map((s) => ({
              series: s.key,
              label: s.label,
              value: formatPrice(s.prices[hovered - 1] as number),
            }))}
          />
        )}
      </div>
    </div>
  );
}
