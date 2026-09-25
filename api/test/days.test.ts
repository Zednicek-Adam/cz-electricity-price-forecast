/**
 * Seam 3 for the Day view: the Hono app's fetch handler, invoked directly, as
 * `app_reader` against the seeded Postgres. Request in, JSON out.
 */
import { describe, expect, test } from "vitest";

import { app } from "../src/app.ts";
import type { DeliveryDayResponse, NotInRecordResponse } from "../src/index.ts";
import {
  BROKEN,
  FALL_BACK,
  FIRST_DAY,
  LAST_DAY,
  NEGATIVE,
  OFFSETS,
  ORDINARY_DAY,
  READER_URL,
  SPRING_FORWARD,
  price,
} from "./fixture.ts";

const env = { NEON_READER: READER_URL };

async function get(path: string): Promise<Response> {
  return app.request(path, undefined, env);
}

async function day(deliveryDate: string): Promise<DeliveryDayResponse> {
  const response = await get(`/api/days/${deliveryDate}`);
  expect(response.status).toBe(200);
  return (await response.json()) as DeliveryDayResponse;
}

const ordinals = Array.from({ length: 24 }, (_, i) => i + 1);

describe("GET /api/days/:deliveryDate", () => {
  test("returns the observed price and every model over 24 period ordinals", async () => {
    expect(await day(ORDINARY_DAY)).toEqual<DeliveryDayResponse>({
      deliveryDate: ORDINARY_DAY,
      observed: ordinals.map((o) => price(ORDINARY_DAY, o, OFFSETS.observed)),
      forecasts: [
        {
          model: "ar168",
          prices: ordinals.map((o) => price(ORDINARY_DAY, o, OFFSETS.ar168)),
        },
        {
          model: "daylag",
          prices: ordinals.map((o) => price(ORDINARY_DAY, o, OFFSETS.daylag)),
        },
      ],
    });
  });

  test.each([SPRING_FORWARD, FALL_BACK])(
    "the daylight-saving day %s returns 24 period ordinals",
    async (deliveryDate) => {
      const body = await day(deliveryDate);

      expect(body.observed).toHaveLength(24);
      for (const forecast of body.forecasts) {
        expect(forecast.prices).toHaveLength(24);
      }
    },
  );

  test("a negative price is returned as it was cleared", async () => {
    const body = await day(NEGATIVE.day);

    expect(body.observed[NEGATIVE.ordinal - 1]).toBe(NEGATIVE.price);
  });

  test.each([FIRST_DAY, LAST_DAY])(
    "the backtest window's end %s is served",
    async (deliveryDate) => {
      const body = await day(deliveryDate);

      expect(body.deliveryDate).toBe(deliveryDate);
      expect(body.forecasts).toHaveLength(2);
    },
  );

  test.each(["2019-12-31", "2025-01-01", "2023-06-15"])(
    "a delivery day the record does not hold, %s, is a 404 naming the record",
    async (deliveryDate) => {
      const response = await get(`/api/days/${deliveryDate}`);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual<NotInRecordResponse>({
        error: "not_in_record",
        deliveryDate,
        record: { first: FIRST_DAY, last: LAST_DAY },
      });
    },
  );

  test.each(["yesterday", "2024-02-30", "2024-1-5"])(
    "%s is a 400",
    async (deliveryDate) => {
      const response = await get(`/api/days/${deliveryDate}`);

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "bad_request" });
    },
  );

  test.each(Object.entries(BROKEN))(
    "a day the store holds only in part (%s) is a 500, never a short answer",
    async (_, deliveryDate) => {
      const response = await get(`/api/days/${deliveryDate}`);

      expect(response.status).toBe(500);
    },
  );
});
