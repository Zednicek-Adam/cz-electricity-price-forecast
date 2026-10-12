/**
 * Electricity price distribution profile by hour (24 periods) or by weekday
 * (7 days) over the selected history scope.
 *
 * Shows the price behavior and distribution:
 * - Full range (min – max) shaded band
 * - Interquartile range (25th – 75th percentile) shaded band
 * - Median line (solid ink)
 * - Mean line (dashed ink)
 *
 * Visx primitives only, fluid viewBox, matching the hero chart's geometry.
 */
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { useState } from "react";

import { TICK_LABEL, Tooltip, YGrid } from "./ChartParts.tsx";
import { formatTick, paddedDomain, spreadLabels } from "./charts.ts";
import { formatPrice, SCOPE_LABELS, WEEKDAYS } from "./presentation.ts";
import type { PriceDistribution, PriceProfile } from "./price.ts";

const WIDTH = 960;
const HEIGHT = 280;
const MARGIN = { top: 26, right: 96, bottom: 30, left: 48 };

interface Buckets {
  count: number;
  tick: (i: number) => string;
  title: (i: number) => string;
  sparse: number[];
  axis: string;
  described: string;
}

const BUCKETS: Record<PriceProfile["by"], Buckets> = {
  weekday: {
    count: 7,
    tick: (i) => WEEKDAYS[i]?.slice(0, 3) ?? "",
    title: (i) => WEEKDAYS[i] ?? "",
    sparse: [0, 1, 2, 3, 4, 5, 6],
    axis: "Weekday",
    described: "Monday to Sunday",
  },
  period: {
    count: 24,
    tick: (i) => String(i + 1),
    title: (i) => `Period ${i + 1}`,
    sparse: [0, 5, 11, 17, 23],
    axis: "Period",
    described: "periods 1 to 24",
  },
};

function bandPath(
  indices: number[],
  x: (i: number) => number,
  y: (val: number) => number,
  upper: (i: number) => number,
  lower: (i: number) => number,
): string {
  if (indices.length === 0) return "";
  const top = indices.map(
    (i, idx) => `${idx === 0 ? "M" : "L"} ${x(i)} ${y(upper(i))}`,
  );
  const bottom = [...indices].reverse().map((i) => `L ${x(i)} ${y(lower(i))}`);
  return `${top.join(" ")} ${bottom.join(" ")} Z`;
}

export function PriceProfileChart({ profile }: { profile: PriceProfile }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const buckets = BUCKETS[profile.by];
  const last = buckets.count - 1;
  const indices = Array.from({ length: buckets.count }, (_, i) => i);
  const bucketsData = profile.buckets;

  const x = scaleLinear({
    domain: [0, last],
    range: [MARGIN.left, WIDTH - MARGIN.right],
  });

  const validBuckets = bucketsData.filter(
    (b): b is PriceDistribution => b !== null,
  );
  const allY = validBuckets.flatMap((b) => [b.min, b.max]);
  const y = scaleLinear({
    domain: paddedDomain(allY.length ? allY : [0, 100], 0.12),
    range: [HEIGHT - MARGIN.bottom, MARGIN.top],
    nice: true,
  });

  const ticks = y.ticks(5);
  const bottom = HEIGHT - MARGIN.bottom;
  const columnWidth = (WIDTH - MARGIN.left - MARGIN.right) / Math.max(last, 1);

  const lastBucket = bucketsData[last];
  const lastMedian = lastBucket?.median ?? 0;
  const lastMean = lastBucket?.mean ?? 0;
  const labelY = spreadLabels([y(lastMedian) + 4, y(lastMean) + 4], 14);

  const rangeD = bandPath(
    indices,
    x,
    y,
    (i) => bucketsData[i]?.max ?? 0,
    (i) => bucketsData[i]?.min ?? 0,
  );

  const iqrD = bandPath(
    indices,
    x,
    y,
    (i) => bucketsData[i]?.q75 ?? 0,
    (i) => bucketsData[i]?.q25 ?? 0,
  );

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

  const hoveredBucket = hovered !== null ? bucketsData[hovered] : null;

  return (
    <div className="chart-frame">
      <div className="chart">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`Electricity price distribution over the ${SCOPE_LABELS[
            profile.scope
          ].toLowerCase()}, ${buckets.described}.`}
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
          <Group className="ticks-dense">{axis(indices, 11)}</Group>
          <Group className="ticks-sparse">{axis(buckets.sparse, 14)}</Group>
          <text x={WIDTH - MARGIN.right + 12} y={bottom + 18} {...TICK_LABEL}>
            {buckets.axis}
          </text>

          {/* Full range (min-max) band */}
          {rangeD && (
            <path
              d={rangeD}
              fill="rgba(17, 17, 16, 0.06)"
              stroke="rgba(17, 17, 16, 0.12)"
              strokeWidth={0.5}
            />
          )}

          {/* Interquartile range (25th-75th) band */}
          {iqrD && (
            <path
              d={iqrD}
              fill="rgba(17, 17, 16, 0.14)"
              stroke="rgba(17, 17, 16, 0.22)"
              strokeWidth={0.5}
            />
          )}

          {/* Mean line */}
          <LinePath
            data={indices}
            defined={(i) => bucketsData[i] !== null}
            x={(i) => x(i)}
            y={(i) => y(bucketsData[i]?.mean ?? 0)}
            stroke="var(--ink-2)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />

          {/* Median line */}
          <LinePath
            data={indices}
            defined={(i) => bucketsData[i] !== null}
            x={(i) => x(i)}
            y={(i) => y(bucketsData[i]?.median ?? 0)}
            stroke="var(--ink)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />

          {/* Right edge labels */}
          {lastBucket && (
            <>
              <circle
                cx={x(last)}
                cy={y(lastMedian)}
                r={3.5}
                fill="var(--ink)"
                stroke="var(--surface)"
                strokeWidth={2}
              />
              <text
                x={x(last) + 10}
                y={labelY[0]}
                fill="var(--ink)"
                fontSize={11.5}
                fontWeight={600}
              >
                Median
              </text>
              <text
                x={x(last) + 10}
                y={labelY[1]}
                fill="var(--ink-2)"
                fontSize={11.5}
                fontWeight={500}
              >
                Mean
              </text>
            </>
          )}

          {/* Hover crosshair and markers */}
          {hovered !== null && hoveredBucket && (
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
                cy={y(hoveredBucket.median)}
                r={4}
                fill="var(--ink)"
                stroke="var(--surface)"
                strokeWidth={2}
              />
              <circle
                cx={x(hovered)}
                cy={y(hoveredBucket.mean)}
                r={3.5}
                fill="var(--ink-2)"
                stroke="var(--surface)"
                strokeWidth={2}
              />
            </g>
          )}

          {/* Invisible interactive columns */}
          {indices.map((i) => (
            <rect
              key={i}
              data-price-bucket={i}
              data-price-ordinal={i + 1}
              x={x(i) - columnWidth / 2}
              y={MARGIN.top}
              width={columnWidth}
              height={bottom - MARGIN.top}
              fill="transparent"
              onMouseEnter={() => setHovered(i)}
            />
          ))}
        </svg>

        {hovered !== null && hoveredBucket && (
          <Tooltip
            title={buckets.title(hovered)}
            at={x(hovered) / WIDTH}
            rows={[
              {
                series: "observed",
                label: "Median",
                value: `${formatPrice(hoveredBucket.median)} EUR/MWh`,
              },
              {
                series: "observed",
                label: "Mean",
                value: `${formatPrice(hoveredBucket.mean)} EUR/MWh`,
              },
              {
                series: "observed",
                label: "50% IQR",
                value: `${formatPrice(hoveredBucket.q25)} – ${formatPrice(hoveredBucket.q75)}`,
              },
              {
                series: "observed",
                label: "Range",
                value: `${formatPrice(hoveredBucket.min)} – ${formatPrice(hoveredBucket.max)}`,
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}
