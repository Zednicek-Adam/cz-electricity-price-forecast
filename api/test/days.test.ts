/**
 * Seam 3 for the Day view: the Hono app's fetch handler, invoked directly, as
 * `app_reader` against the seeded Postgres. Request in, JSON out.
 */
import { describe, expect, test } from "vitest";

import { app } from "../src/app.ts";
import type { DeliveryDayResponse, NotInRecordResponse } from "../src/index.ts";
import {
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

const ordinals = Array.from({ length: 24 }, (_, i) => i + 1);

describe("GET /api/days/:date", () => {
  test("returns the observed price and every model over 24 period ordinals", async () => {
    const response = await get(`/api/days/${ORDINARY_DAY}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual<DeliveryDayResponse>({
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

  test("a daylight-saving day returns 24 period ordinals", async () => {
    const body = (await (
      await get(`/api/days/${SPRING_FORWARD}`)
    ).json()) as DeliveryDayResponse;

    expect(body.observed).toHaveLength(24);
    for (const forecast of body.forecasts)
      expect(forecast.prices).toHaveLength(24);
  });

  test("a negative price is returned as it was cleared", async () => {
    const body = (await (
      await get(`/api/days/${NEGATIVE.day}`)
    ).json()) as DeliveryDayResponse;

    expect(body.observed[NEGATIVE.ordinal - 1]).toBe(NEGATIVE.price);
  });

  test.each([FIRST_DAY, LAST_DAY])(
    "the replay window's end %s is served",
    async (day) => {
      const response = await get(`/api/days/${day}`);

      expect(response.status).toBe(200);
      const body = (await response.json()) as DeliveryDayResponse;
      expect(body.deliveryDate).toBe(day);
      expect(body.forecasts.map((f) => f.model)).toEqual(["ar168", "daylag"]);
    },
  );

  test.each(["2019-12-31", "2025-01-01", "2023-06-15"])(
    "a day the record does not hold, %s, is a 404 naming the record",
    async (day) => {
      const response = await get(`/api/days/${day}`);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual<NotInRecordResponse>({
        error: "not_in_record",
        deliveryDate: day,
        record: { first: FIRST_DAY, last: LAST_DAY },
      });
    },
  );

  test.each(["yesterday", "2024-02-30", "2024-1-5"])(
    "%s is a 400",
    async (day) => {
      const response = await get(`/api/days/${day}`);

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "bad_request" });
    },
  );
});
