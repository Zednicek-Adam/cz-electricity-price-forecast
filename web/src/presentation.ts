/**
 * How the interface names, colours and formats things. Rendering rules only:
 * every figure arrives from the export already computed.
 */
import type { DeliveryDate, Metric, ModelSlug, Scope } from "./types.ts";

/** The benchmark is "Naïve" in the interface; the slug stays `daylag` (ADR-0007). */
export const MODEL_LABELS: Record<ModelSlug, string> = {
  chronos2: "Chronos-2",
  ar168: "AR-168",
  daylag: "Naïve",
};

/** Series colours, as CSS custom properties defined in styles.css. */
export const SERIES_COLOURS: Record<ModelSlug | "observed", string> = {
  observed: "var(--series-observed)",
  chronos2: "var(--series-chronos2)",
  ar168: "var(--series-ar168)",
  daylag: "var(--series-daylag)",
};

/** The naïve is dashed wherever it is drawn: a second channel beside its
 * colour, so identity never rests on hue alone. */
export const SERIES_DASH: Partial<Record<ModelSlug | "observed", string>> = {
  daylag: "5 4",
};

export const METRICS: readonly Metric[] = ["mae", "rmse", "smape", "rmae"];

interface MetricPresentation {
  label: string;
  /** Rendered after the figure; rMAE renders bare (ADR-0007). */
  unit: string;
  /** Precision is part of the definition (ADR-0006). */
  decimals: number;
}

export const METRIC_PRESENTATION: Record<Metric, MetricPresentation> = {
  mae: { label: "MAE", unit: "EUR/MWh", decimals: 1 },
  rmse: { label: "RMSE", unit: "EUR/MWh", decimals: 1 },
  smape: { label: "SMAPE", unit: "", decimals: 1 },
  rmae: { label: "rMAE", unit: "", decimals: 3 },
};

/** A metric figure to its fixed precision; an unpublished one as a dash. */
export function formatMetric(metric: Metric, value: number | null): string {
  return value === null
    ? "–"
    : value.toFixed(METRIC_PRESENTATION[metric].decimals);
}

/** A price as the market clears it: EUR/MWh to two decimals, sign intact. */
export function formatPrice(value: number): string {
  return value.toFixed(2);
}

/** The scoreboard's two scopes, as its scope switch names them. */
export const SCOPE_LABELS: Record<Scope, string> = {
  whole: "Whole record",
  window: "Last 30 days",
};

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** A delivery day as a reader names it, weekday first: "Tue 31 Dec 2024".
 * The date alone is formatted, so no time zone can shift it. */
export function formatDay(day: DeliveryDate): string {
  return DAY_FORMAT.format(new Date(`${day}T00:00:00Z`)).replace(",", "");
}
