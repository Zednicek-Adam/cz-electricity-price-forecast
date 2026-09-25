/**
 * The running metric: the one figure the request path derives (ADR-0015).
 *
 * A running figure is a cumulative sum over a cumulative count of delivery
 * periods, never a running mean of per-day figures. Each per-day published
 * metric is weighted by its own `n_forecasts`, which turns it back into the
 * day's sum exactly:
 *
 *   mae, smape   carry n × value            running = Σ n × value / Σ n
 *   rmse         carry n × value²           running = sqrt(Σ n × value² / Σ n)
 *   rmae         running MAE of the model over running MAE of the naïve
 *
 * The rMAE line is the trap ADR-0015 names: the ratio of two running MAEs, not
 * a running mean of the per-day ratios, which one near-flat naïve day would
 * drag for the rest of the record.
 */
import type { DeliveryDate, Metric } from "./index.ts";

/** One stored per-day figure: a `delivery_day` row of `published_metric`. */
export interface DayFigure {
  deliveryDate: DeliveryDate;
  value: number;
  nForecasts: number;
}

/**
 * The running value of a sum-and-count metric on each of `dates`, from a
 * model's per-day figures. `null` until the model's first day.
 */
function accumulate(
  dates: DeliveryDate[],
  figures: DayFigure[],
  squared: boolean,
): (number | null)[] {
  const byDate = new Map(figures.map((f) => [f.deliveryDate, f]));
  let sum = 0;
  let count = 0;
  return dates.map((date) => {
    const figure = byDate.get(date);
    if (figure) {
      const value = squared ? figure.value ** 2 : figure.value;
      sum += figure.nForecasts * value;
      count += figure.nForecasts;
    }
    if (count === 0) return null;
    return squared ? Math.sqrt(sum / count) : sum / count;
  });
}

/**
 * The running series for one model and one sum-and-count metric, aligned with
 * `dates`. rMAE is not one: it takes `runningRatio`, and the type keeps it out.
 */
export function running(
  metric: Exclude<Metric, "rmae">,
  dates: DeliveryDate[],
  figures: DayFigure[],
): (number | null)[] {
  return accumulate(dates, figures, metric === "rmse");
}

/** Running rMAE: the model's running MAE over the naïve's, day by day. */
export function runningRatio(
  dates: DeliveryDate[],
  modelMae: DayFigure[],
  naiveMae: DayFigure[],
): (number | null)[] {
  const numerator = accumulate(dates, modelMae, false);
  const denominator = accumulate(dates, naiveMae, false);
  return numerator.map((value, i) => {
    const naive = denominator[i];
    return value === null || !naive ? null : value / naive;
  });
}
