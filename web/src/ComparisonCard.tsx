/**
 * The Diebold–Mariano card: for a selected model, `dm_statistic` against each
 * opponent over the 24 period ordinals, with reference lines at ±1.96
 * (ADR-0006, ADR-0007), over the scoreboard's scope — the whole record or
 * the last 30 days (ADR-0017).
 *
 * The statistic is plotted, not the p-value: it is signed, so direction reads
 * off the sign — negative means the selected model's errors were smaller — and
 * it shows how separated two models are. The two sides of the band are named
 * on the chart, so the sign never has to be remembered. ±1.96 is the
 * two-sided 5% band; the stored tests are one-sided, so this is the stricter
 * bar. An hour whose test could not be computed is a gap in the line.
 */
import type { Comparison, ModelSlug } from "./types.ts";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";

import { EndMarker, TICK_LABEL } from "./ChartParts.tsx";
import { spreadLabels } from "./charts.ts";
import { Legend } from "./Legend.tsx";
import { MODEL_LABELS, SERIES_COLOURS, SERIES_DASH } from "./presentation.ts";
import { Segmented } from "./Segmented.tsx";

const WIDTH = 960;
const HEIGHT = 280;
const MARGIN = { top: 14, right: 112, bottom: 30, left: 44 };
const BAND = 1.96;
/** The band's two sides, named just outside it, haloed in the surface colour
 * so a line crossing them never hides them. */
const SIDE_LABEL = {
  ...TICK_LABEL,
  fill: "var(--ink-2)",
  stroke: "var(--surface)",
  strokeWidth: 4,
  paintOrder: "stroke",
  strokeLinejoin: "round",
} as const;

interface Props {
  comparison: Comparison;
  models: ModelSlug[];
  onModel: (model: ModelSlug) => void;
}

export function ComparisonCard({ comparison, models, onModel }: Props) {
  const { model } = comparison;
  return (
    <>
      <div className="card-bar">
        <div>
          <h3>Diebold–Mariano test by period</h3>
          <p className="subtle">
            {MODEL_LABELS[model]} against each other model, period ordinals 1 to
            24
          </p>
        </div>
        <Segmented
          label="Model"
          options={models}
          value={model}
          onChange={onModel}
          name={(m) => MODEL_LABELS[m]}
          size="small"
        />
      </div>
      <Legend series={comparison.opponents.map((o) => o.opponent)} />
      <ComparisonChart comparison={comparison} />
    </>
  );
}

function ComparisonChart({ comparison }: { comparison: Comparison }) {
  const statistics = comparison.opponents.flatMap((o) =>
    o.dmStatistic.filter((v): v is number => v !== null),
  );
  const x = scaleLinear({
    domain: [1, 24],
    range: [MARGIN.left, WIDTH - MARGIN.right],
  });
  const y = scaleLinear({
    domain: [
      // Headroom past the band on both sides, for the two side labels.
      Math.min(-3.5, ...statistics) - 0.5,
      Math.max(3.5, ...statistics) + 0.5,
    ],
    range: [HEIGHT - MARGIN.bottom, MARGIN.top],
    nice: true,
  });
  /** The last period ordinal with a statistic, and the statistic. */
  const lastPoint = (values: (number | null)[]): [number, number] => {
    const at = values.findLastIndex((v) => v !== null);
    return at < 0 ? [24, 0] : [at + 1, values[at] as number];
  };
  const labelY = spreadLabels(
    comparison.opponents.map((o) => y(lastPoint(o.dmStatistic)[1]) + 4),
    14,
  );
  const name = MODEL_LABELS[comparison.model];
  const label = `Diebold–Mariano statistic of ${name} against ${comparison.opponents
    .map((o) => MODEL_LABELS[o.opponent])
    .join(
      " and ",
    )}, by period ordinal 1 to 24, with reference lines at plus and minus 1.96.`;
  const left = MARGIN.left;
  const right = WIDTH - MARGIN.right;

  return (
    <div className="chart-frame">
      <div className="chart">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label}>
          <rect
            className="band"
            x={left}
            width={right - left}
            y={y(BAND)}
            height={y(-BAND) - y(BAND)}
            fill="var(--band)"
          />
          {[0, BAND, -BAND].map((v) => (
            <line
              key={v}
              className={v === 0 ? "zero" : "reference"}
              x1={left}
              x2={right}
              y1={y(v)}
              y2={y(v)}
              stroke={v === 0 ? "var(--axis)" : "var(--muted)"}
              strokeDasharray={v === 0 ? undefined : "3 3"}
            />
          ))}
          <g className="side-labels" {...SIDE_LABEL}>
            <text x={left + 8} y={y(BAND) - 7}>
              ↑ Opponent more accurate
            </text>
            <text x={left + 8} y={y(-BAND) + 16}>
              ↓ {name} more accurate
            </text>
          </g>
          <AxisLeft
            scale={y}
            left={left}
            tickValues={[...new Set([...y.ticks(4), -BAND, BAND])]}
            tickFormat={(v) =>
              Math.abs(Number(v)) === BAND ? Number(v).toFixed(2) : String(v)
            }
            hideAxisLine
            hideTicks
            tickLabelProps={{ ...TICK_LABEL, fontSize: 10 }}
          />
          <AxisBottom
            scale={x}
            top={HEIGHT - MARGIN.bottom}
            tickValues={[1, 4, 8, 12, 16, 20, 24]}
            stroke="var(--axis)"
            tickStroke="var(--axis)"
            tickLength={4}
            tickLabelProps={TICK_LABEL}
          />
          <text x={right + 12} y={HEIGHT - MARGIN.bottom + 18} {...TICK_LABEL}>
            Period
          </text>
          {comparison.opponents.map((o, index) => (
            <Group key={o.opponent}>
              <LinePath
                data={o.dmStatistic}
                defined={(v) => v !== null}
                x={(_, i) => x(i + 1)}
                y={(v) => y(v ?? 0)}
                stroke={SERIES_COLOURS[o.opponent]}
                strokeWidth={2}
                strokeDasharray={SERIES_DASH[o.opponent]}
                strokeLinejoin="round"
                fill="none"
              />
              <EndMarker
                series={o.opponent}
                label={`vs ${MODEL_LABELS[o.opponent]}`}
                x={x(lastPoint(o.dmStatistic)[0])}
                y={y(lastPoint(o.dmStatistic)[1])}
                labelY={labelY[index] as number}
              />
            </Group>
          ))}
        </svg>
      </div>
    </div>
  );
}
