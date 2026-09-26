/**
 * The Diebold–Mariano card: for a selected model, `dm_statistic` against each
 * opponent over the 24 period ordinals, with reference lines at ±1.96
 * (ADR-0006, ADR-0007).
 *
 * The statistic is plotted, not the p-value: it is signed, so direction reads
 * off the sign — negative means the selected model's errors were smaller — and
 * it shows how separated two models are. ±1.96 is the two-sided 5% band; the
 * stored tests are one-sided, so this is the stricter bar. An hour whose test
 * could not be computed is a gap in the line.
 */
import type { ComparisonResponse, ModelSlug } from "@cz-epf/api";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";

import { useJson } from "./api.ts";
import { spreadLabels } from "./charts.ts";
import { MODEL_LABELS, SERIES_COLOURS } from "./presentation.ts";

const WIDTH = 900;
const HEIGHT = 250;
const MARGIN = { top: 14, right: 96, bottom: 26, left: 44 };
const BAND = 1.96;

interface Props {
  model: ModelSlug;
  models: ModelSlug[];
  onModel: (model: ModelSlug) => void;
}

export function ComparisonCard({ model, models, onModel }: Props) {
  const comparison = useJson<ComparisonResponse>(`/api/comparisons/${model}`);

  return (
    <>
      <div className="card-bar">
        <h2 className="caption">
          Diebold–Mariano statistic by period ordinal · {MODEL_LABELS[model]}
        </h2>
        <div className="toggle-group" role="group" aria-label="Model">
          {models.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={m === model}
              onClick={() => onModel(m)}
            >
              {MODEL_LABELS[m]}
            </button>
          ))}
        </div>
      </div>
      {comparison.state === "ready" && (
        <ComparisonChart comparison={comparison.data} />
      )}
    </>
  );
}

function ComparisonChart({ comparison }: { comparison: ComparisonResponse }) {
  const statistics = comparison.opponents.flatMap((o) =>
    o.dmStatistic.filter((v): v is number => v !== null),
  );
  const x = scaleLinear({
    domain: [1, 24],
    range: [MARGIN.left, WIDTH - MARGIN.right],
  });
  const y = scaleLinear({
    domain: [
      Math.min(-2.5, ...statistics) - 0.5,
      Math.max(2.5, ...statistics) + 0.5,
    ],
    range: [HEIGHT - MARGIN.bottom, MARGIN.top],
    nice: true,
  });
  const lastPoint = (values: (number | null)[]): number =>
    values.findLast((v) => v !== null) ?? 0;
  const labelY = spreadLabels(
    comparison.opponents.map((o) => y(lastPoint(o.dmStatistic)) + 4),
  );
  const label = `Diebold–Mariano statistic of ${MODEL_LABELS[comparison.model]} against ${comparison.opponents
    .map((o) => MODEL_LABELS[o.opponent])
    .join(
      " and ",
    )}, by period ordinal 1 to 24, with reference lines at plus and minus 1.96.`;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label}>
        {[0, BAND, -BAND].map((v) => (
          <line
            key={v}
            className={v === 0 ? "zero" : "reference"}
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={y(v)}
            y2={y(v)}
            stroke={v === 0 ? "var(--axis)" : "var(--muted)"}
            strokeDasharray={v === 0 ? undefined : "3 3"}
          />
        ))}
        <AxisLeft
          scale={y}
          left={MARGIN.left}
          tickValues={[...new Set([...y.ticks(4), -BAND, BAND])]}
          tickFormat={(v) =>
            Math.abs(Number(v)) === BAND ? Number(v).toFixed(2) : String(v)
          }
          stroke="var(--axis)"
          tickStroke="var(--axis)"
          tickLabelProps={{ fill: "var(--muted)", fontSize: 10 }}
        />
        <AxisBottom
          scale={x}
          top={HEIGHT - MARGIN.bottom}
          tickValues={[1, 6, 12, 18, 24]}
          stroke="var(--axis)"
          tickStroke="var(--axis)"
          tickLabelProps={{ fill: "var(--muted)", fontSize: 10 }}
        />
        {comparison.opponents.map((o, index) => (
          <Group key={o.opponent}>
            <LinePath
              data={o.dmStatistic}
              defined={(v) => v !== null}
              x={(_, i) => x(i + 1)}
              y={(v) => y(v ?? 0)}
              stroke={SERIES_COLOURS[o.opponent]}
              strokeWidth={2}
              strokeLinejoin="round"
              fill="none"
            />
            <text
              x={WIDTH - MARGIN.right + 6}
              y={labelY[index]}
              fill={SERIES_COLOURS[o.opponent]}
              fontSize={11}
              fontWeight={600}
            >
              vs {MODEL_LABELS[o.opponent]}
            </text>
          </Group>
        ))}
      </svg>
    </div>
  );
}
