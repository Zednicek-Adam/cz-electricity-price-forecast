/**
 * Seam 3 for the four metric endpoints: the Over time view, the ribbon, the
 * accuracy table and the Diebold-Mariano card. The app's fetch handler, as
 * `app_reader`, against the seeded Postgres. Expected figures are worked out
 * by hand from `metrics-fixture.ts`, not recomputed with the code under test.
 */
import { describe, expect, test } from "vitest";

import { app } from "../src/app.ts";
import type {
  AccuracyResponse,
  ComparisonResponse,
  DailyMetricResponse,
  RunningMetricResponse,
} from "../src/index.ts";
import { READER_URL } from "./fixture.ts";
import { METRIC_DAYS, OVERALL } from "./metrics-fixture.ts";

const env = { NEON_READER: READER_URL };

async function get<T>(path: string, status = 200): Promise<T> {
  const response = await app.request(path, undefined, env);
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

function values(body: RunningMetricResponse, model: string): (number | null)[] {
  const series = body.series.find((s) => s.model === model);
  if (!series) throw new Error(`no ${model} series`);
  return series.values;
}

describe("GET /api/running/:metric", () => {
  test("MAE accumulates periods, weighting each day by its forecasts", async () => {
    const body = await get<RunningMetricResponse>("/api/running/mae");

    expect(body.deliveryDates).toEqual([...METRIC_DAYS]);
    expect(body.series.map((s) => s.model)).toEqual([
      "chronos2",
      "ar168",
      "daylag",
    ]);
    expect(values(body, "daylag")).toEqual([
      10,
      15,
      expect.closeTo(23.333333, 5),
      25,
    ]);
    // No ar168 figure on the fourth day: its running MAE carries forward.
    expect(values(body, "ar168")).toEqual([5, 7.5, 15, 15]);
    // 24 periods at 4, then 12 at 12, then 24 at 20: 96/24, 240/36, 720/60.
    expect(values(body, "chronos2")).toEqual([
      4,
      expect.closeTo(6.666667, 5),
      12,
      12,
    ]);
  });

  test("running rMAE is the ratio of two running MAEs", async () => {
    const body = await get<RunningMetricResponse>("/api/running/rmae");

    // ar168's per-day rMAEs are 0.5, 0.5, 0.75. Their running mean on the
    // third day would be 0.583; the ratio of running MAEs is 15 / 23.333.
    // On the fourth day ar168 has no figure but the naïve does, so its
    // running rMAE moves: 15 / 25.
    expect(values(body, "ar168")).toEqual([
      0.5,
      0.5,
      expect.closeTo(0.642857, 5),
      0.6,
    ]);
    expect(values(body, "chronos2")).toEqual([
      0.4,
      expect.closeTo(0.444444, 5),
      expect.closeTo(0.514286, 5),
      0.48,
    ]);
    expect(values(body, "daylag")).toEqual([1, 1, 1, 1]);
  });

  test("running RMSE accumulates squared errors, not RMSEs", async () => {
    const body = await get<RunningMetricResponse>("/api/running/rmse");

    // sqrt((12² + 24²) / 2), sqrt((12² + 24² + 48²) / 3), and with 24² a
    // fourth time, sqrt(3600 / 4).
    expect(values(body, "daylag")).toEqual([
      12,
      expect.closeTo(18.973666, 5),
      expect.closeTo(31.749016, 5),
      30,
    ]);
  });

  test("SMAPE, which the table only drills into, runs like the others", async () => {
    const body = await get<RunningMetricResponse>("/api/running/smape");

    expect(values(body, "chronos2")).toEqual([
      8,
      expect.closeTo(9.333333, 5),
      12,
      12,
    ]);
  });

  test.each(["mae", "rmse", "smape", "rmae"] as const)(
    "the last running %s equals the stored whole-record figure",
    async (metric) => {
      const body = await get<RunningMetricResponse>(`/api/running/${metric}`);

      for (const series of body.series) {
        expect(series.values.at(-1)).toBeCloseTo(
          OVERALL[series.model][metric],
          9,
        );
      }
    },
  );
});

describe("GET /api/daily/:metric", () => {
  test("is the headline model's own per-day figures, as stored", async () => {
    const body = await get<DailyMetricResponse>("/api/daily/mae");

    expect(body).toEqual<DailyMetricResponse>({
      model: "chronos2",
      metric: "mae",
      deliveryDates: METRIC_DAYS.slice(0, 3),
      values: [4, 12, 20],
    });
  });

  test("differs from the running series on the same day", async () => {
    const daily = await get<DailyMetricResponse>("/api/daily/mae");
    const running = await get<RunningMetricResponse>("/api/running/mae");

    expect(daily.values[2]).toBe(20);
    expect(values(running, "chronos2")[2]).toBe(12);
  });

  test("a live figure is never pooled with the backtest", async () => {
    const body = await get<DailyMetricResponse>("/api/daily/mae");

    expect(body.values).not.toContain(999);
  });

  test.each([
    ["rmae", [0.4, 0.6, 0.5]],
    ["rmse", [5, 15, 25]],
    ["smape", [8, 12, 16]],
  ] as const)("per-day %s is the stored figure", async (metric, expected) => {
    const body = await get<DailyMetricResponse>(`/api/daily/${metric}`);

    expect(body.values).toEqual(expected);
  });
});

describe("GET /api/accuracy", () => {
  test("is every model against four metrics over the whole record", async () => {
    const body = await get<AccuracyResponse>("/api/accuracy");

    expect(body.rows.map((r) => r.model)).toEqual([
      "chronos2",
      "ar168",
      "daylag",
    ]);
    for (const row of body.rows) {
      for (const metric of ["mae", "rmse", "smape", "rmae"] as const) {
        expect(row[metric]).toBeCloseTo(OVERALL[row.model][metric], 9);
      }
    }
  });

  test("the naïve's rMAE reads exactly 1.000", async () => {
    const body = await get<AccuracyResponse>("/api/accuracy");

    expect(body.rows.find((r) => r.model === "daylag")?.rmae).toBe(1);
  });
});

describe("GET /api/comparisons/:model", () => {
  test("returns the DM statistic by period ordinal against both opponents", async () => {
    const body = await get<ComparisonResponse>("/api/comparisons/chronos2");

    expect(body.model).toBe("chronos2");
    expect(body.opponents.map((o) => o.opponent)).toEqual(["ar168", "daylag"]);
    const [ar168, daylag] = body.opponents;
    expect(ar168?.dmStatistic).toHaveLength(24);
    expect(ar168?.dmStatistic[0]).toBeCloseTo(-0.1, 9);
    expect(ar168?.pValue[23]).toBeCloseTo(0.24, 9);
    // The ordinal-24 test against the naïve failed to compute: no figure.
    expect(daylag?.dmStatistic[22]).toBeCloseTo(-4.6, 9);
    expect(daylag?.dmStatistic[23]).toBeNull();
  });

  test("the reverse direction is the same test seen from the other side", async () => {
    const body = await get<ComparisonResponse>("/api/comparisons/ar168");

    expect(body.opponents.map((o) => o.opponent)).toEqual(["chronos2"]);
    expect(body.opponents[0]?.dmStatistic[0]).toBeCloseTo(0.1, 9);
    expect(body.opponents[0]?.pValue[0]).toBeCloseTo(0.99, 9);
  });
});

describe("what the selector cannot ask for", () => {
  test.each([
    "/api/running/mape",
    "/api/daily/accuracy",
    "/api/comparisons/lear",
  ])("%s is a 400", async (path) => {
    expect(await get(path, 400)).toMatchObject({ error: "bad_request" });
  });
});
