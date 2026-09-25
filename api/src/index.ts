/**
 * The API/client contract. `web/` imports these types from `@cz-epf/api`
 * rather than restating what the API returns, so there is nothing to generate
 * and nothing to keep in step by hand (ADR-0004). This module holds types only,
 * so importing it pulls no server code into the client.
 *
 * Every price is EUR/MWh, as the market publishes it, at every layer: nothing
 * here or behind it converts a currency (ADR-0008).
 */

/** The three models of ADR-0003, as they are written on a stored row. */
export type ModelSlug = "chronos2" | "ar168" | "daylag";

/** A delivery day, `YYYY-MM-DD`: a calendar day in `Europe/Prague`. */
export type DeliveryDate = string;

/** One model's 24 forecasts for a delivery day, EUR/MWh. */
export interface ModelForecast {
  model: ModelSlug;
  /** Indexed by period ordinal minus one, on the repaired 24-period grid. */
  prices: number[];
}

/**
 * `GET /api/days/:deliveryDate` — the Day view: the repaired observed price and every
 * model's forecasts over the 24 period ordinals of one delivery day. A
 * daylight-saving day is on the repaired grid like any other (ADR-0006).
 */
export interface DeliveryDayResponse {
  deliveryDate: DeliveryDate;
  /** Repaired observed prices, EUR/MWh, indexed by period ordinal minus one. */
  observed: number[];
  forecasts: ModelForecast[];
}

/** The first and last delivery days the backtest covers. */
export interface RecordExtent {
  first: DeliveryDate;
  last: DeliveryDate;
}

/** 404: the delivery day is not one the record holds. */
export interface NotInRecordResponse {
  error: "not_in_record";
  deliveryDate: DeliveryDate;
  /** The record's extent, or null while the store holds no forecasts. */
  record: RecordExtent | null;
}

/** 400: the request itself is malformed. */
export interface BadRequestResponse {
  error: "bad_request";
  message: string;
}
