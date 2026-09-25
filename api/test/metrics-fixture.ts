/**
 * Published metrics and model comparisons for seam 3, chosen so every figure
 * the endpoints derive can be checked by hand.
 *
 * Four delivery days. `chronos2`'s second day carries 12 forecasts rather than
 * 24, so a running figure that ignores `n_forecasts` gets it wrong. `ar168`'s
 * per-day rMAEs are 0.5, 0.5, 0.75, whose running mean (0.583) is not its
 * running rMAE (0.643): the trap ADR-0015 names. On the fourth day only the
 * naïve has a figure, so the others' running values carry forward while their
 * running rMAE still moves with the naïve's running MAE.
 */
import type postgres from "postgres";

import type { Metric, ModelSlug } from "../src/index.ts";

export const METRIC_DAYS = [
  "2020-01-01",
  "2020-01-02",
  "2020-01-03",
  "2020-01-04",
] as const;

const METRICS = ["mae", "rmse", "smape", "rmae"] as const satisfies Metric[];

/** Per-day figures, one entry per day from the first, and `n_forecasts`. */
type DayValues = Record<Metric, number[]> & { n: number[] };

export const DAY_FIGURES: Record<ModelSlug, DayValues> = {
  daylag: {
    mae: [10, 20, 40, 30],
    rmse: [12, 24, 48, 24],
    smape: [20, 30, 40, 30],
    rmae: [1, 1, 1, 1],
    n: [24, 24, 24, 24],
  },
  ar168: {
    mae: [5, 10, 30],
    rmse: [6, 12, 36],
    smape: [10, 15, 35],
    rmae: [0.5, 0.5, 0.75],
    n: [24, 24, 24],
  },
  chronos2: {
    mae: [4, 12, 20],
    rmse: [5, 15, 25],
    smape: [8, 12, 16],
    rmae: [0.4, 0.6, 0.5],
    n: [24, 12, 24],
  },
};

/** The whole-record rows the replay would publish for the same forecasts. */
export const OVERALL: Record<ModelSlug, Record<Metric, number>> = {
  // 2400 / 96; sqrt(3600 × 24 / 96); 2880 / 96.
  daylag: { mae: 25, rmse: 30, smape: 30, rmae: 1 },
  ar168: { mae: 15, rmse: Math.sqrt(492), smape: 20, rmae: 15 / 25 },
  chronos2: { mae: 12, rmse: Math.sqrt(305), smape: 12, rmae: 12 / 25 },
};

/** DM of `chronos2` against `ar168` on every ordinal; against the naïve the
 * test for ordinal 24 failed to compute, so there is no row for it. */
export function comparisons(): [
  ModelSlug,
  ModelSlug,
  number,
  number,
  number,
][] {
  const rows: [ModelSlug, ModelSlug, number, number, number][] = [];
  for (let ordinal = 1; ordinal <= 24; ordinal++) {
    const statistic = -ordinal / 10;
    const p = ordinal / 100;
    rows.push(["chronos2", "ar168", ordinal, statistic, p]);
    rows.push(["ar168", "chronos2", ordinal, -statistic, 1 - p]);
    if (ordinal < 24) {
      rows.push(["chronos2", "daylag", ordinal, 2 * statistic, p / 2]);
      rows.push(["daylag", "chronos2", ordinal, -2 * statistic, 1 - p / 2]);
    }
  }
  return rows;
}

export async function seedMetrics(sql: postgres.Sql): Promise<void> {
  for (const [model, values] of Object.entries(DAY_FIGURES)) {
    for (const [i, n] of values.n.entries()) {
      for (const metric of METRICS) {
        await sql`
          INSERT INTO published_metric VALUES (
            ${model}, 'backtest', 'delivery_day', ${METRIC_DAYS[i] ?? ""},
            ${metric}, ${values[metric][i] ?? 0}, ${n}, now()
          )
        `;
      }
    }
  }
  for (const [model, values] of Object.entries(OVERALL)) {
    for (const metric of METRICS) {
      await sql`
        INSERT INTO published_metric VALUES (
          ${model}, 'backtest', 'overall', ${METRIC_DAYS[0]}, ${metric},
          ${values[metric]}, 72, now()
        )
      `;
    }
  }
  // A live figure, which no endpoint may pool with the backtest.
  await sql`
    INSERT INTO published_metric VALUES (
      'chronos2', 'live', 'delivery_day', ${METRIC_DAYS[0]}, 'mae', 999, 24, now()
    )
  `;
  for (const [a, b, ordinal, statistic, p] of comparisons()) {
    await sql`
      INSERT INTO model_comparison VALUES (
        ${a}, ${b}, 'backtest', ${ordinal}, 60, ${statistic}, ${p}, now()
      )
    `;
  }
}
