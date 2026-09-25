/**
 * The hero chart's Day view: the observed price against every model over the
 * 24 period ordinals of one delivery day, EUR/MWh (ADR-0007).
 *
 * visx primitives only — scale, shape, axis, group — and every pointer event
 * is ours (ADR-0009). The crosshair tracks 24 invisible columns, one per
 * period ordinal, so hovering needs no geometry arithmetic. The tooltip is a
 * hand-positioned `div`. Width is fluid through `viewBox`; a CSS breakpoint
 * swaps the tick density.
 *
 * Daylight-saving days are drawn on the repaired 24-period grid like any
 * other, with no note, and negative prices are drawn as they cleared.
 */
import type { DeliveryDayResponse, ModelSlug } from "@cz-epf/api";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { useState } from "react";

import { paddedDomain, spreadLabels } from "./charts.ts";
import { formatPrice, MODEL_LABELS, SERIES_COLOURS } from "./presentation.ts";

const WIDTH = 960;
const HEIGHT = 360;
const MARGIN = { top: 14, right: 84, bottom: 30, left: 52 };
const ORDINALS = Array.from({ length: 24 }, (_, i) => i + 1);

interface Series {
  key: ModelSlug | "observed";
  label: string;
  prices: number[];
}

export function DayChart({ day }: { day: DeliveryDayResponse }) {
  const [hovered, setHovered] = useState<number | null>(null);

  for (const prices of [day.observed, ...day.forecasts.map((f) => f.prices)]) {
    if (prices.length !== 24) {
      throw new Error(`${day.deliveryDate}: ${prices.length} prices, not 24`);
    }
  }
  const series: Series[] = [
    { key: "observed", label: "Observed", prices: day.observed },
    ...day.forecasts.map((f) => ({
      key: f.model,
      label: MODEL_LABELS[f.model],
      prices: f.prices,
    })),
  ];
  const all = series.flatMap((s) => s.prices);
  const x = scaleLinear({
    domain: [1, 24],
    range: [MARGIN.left, WIDTH - MARGIN.right],
  });
  const y = scaleLinear({
    domain: paddedDomain(all),
    range: [HEIGHT - MARGIN.bottom, MARGIN.top],
    nice: true,
  });
  const [low, high] = y.domain() as [number, number];
  const labelY = spreadLabels(
    series.map((s) => y(s.prices.at(-1) as number) + 4),
  );
  const columnWidth = (WIDTH - MARGIN.left - MARGIN.right) / 23;
  const label = `${day.deliveryDate}: the observed price and the forecasts of ${day.forecasts
    .map((f) => MODEL_LABELS[f.model])
    .join(", ")}, in EUR/MWh, by period ordinal 1 to 24.`;

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={label}
        onMouseLeave={() => setHovered(null)}
      >
        <AxisLeft
          scale={y}
          left={MARGIN.left}
          numTicks={5}
          stroke="var(--axis)"
          tickStroke="var(--axis)"
          tickLabelProps={{ fill: "var(--muted)", fontSize: 11 }}
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
        <Group className="ticks-dense">
          <AxisBottom
            scale={x}
            top={HEIGHT - MARGIN.bottom}
            tickValues={ORDINALS}
            stroke="var(--axis)"
            tickStroke="var(--axis)"
            tickLabelProps={{ fill: "var(--muted)", fontSize: 11 }}
          />
        </Group>
        <Group className="ticks-sparse">
          <AxisBottom
            scale={x}
            top={HEIGHT - MARGIN.bottom}
            tickValues={[1, 6, 12, 18, 24]}
            stroke="var(--axis)"
            tickStroke="var(--axis)"
            tickLabelProps={{ fill: "var(--muted)", fontSize: 14 }}
          />
        </Group>
        {series.map((s, index) => (
          <Group key={s.key}>
            <LinePath
              data={s.prices}
              x={(_, i) => x(i + 1)}
              y={(price) => y(price)}
              stroke={SERIES_COLOURS[s.key]}
              strokeWidth={s.key === "observed" ? 2.5 : 2}
              strokeDasharray={s.key === "daylag" ? "5 4" : undefined}
              strokeLinejoin="round"
              fill="none"
            />
            <text
              x={WIDTH - MARGIN.right + 6}
              y={labelY[index]}
              fill={SERIES_COLOURS[s.key]}
              fontSize={11}
              fontWeight={600}
            >
              {s.label}
            </text>
          </Group>
        ))}
        {hovered !== null && (
          <line
            className="crosshair"
            x1={x(hovered)}
            x2={x(hovered)}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
            stroke="var(--ink-2)"
          />
        )}
        {ORDINALS.map((ordinal) => (
          <rect
            key={ordinal}
            data-ordinal={ordinal}
            x={x(ordinal) - columnWidth / 2}
            y={MARGIN.top}
            width={columnWidth}
            height={HEIGHT - MARGIN.top - MARGIN.bottom}
            fill="transparent"
            onMouseEnter={() => setHovered(ordinal)}
          />
        ))}
      </svg>
      {hovered !== null && (
        <div
          aria-hidden="true"
          // Right of the crosshair in the morning, left of it later, so it
          // never runs off the chart's edge.
          className={hovered > 16 ? "tooltip tooltip-left" : "tooltip"}
          style={{ left: `${(x(hovered) / WIDTH) * 100}%` }}
        >
          <div className="tooltip-title">Period {hovered}</div>
          {series.map((s) => (
            <div key={s.key} className="tooltip-row">
              <span
                className="swatch"
                style={{ background: SERIES_COLOURS[s.key] }}
              />
              <span>{s.label}</span>
              <span className="figure">
                {formatPrice(s.prices[hovered - 1] as number)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
