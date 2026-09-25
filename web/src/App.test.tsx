/**
 * Seam 4: the real dashboard rendered in a DOM, with real visx, stubbing only
 * the network with payloads shaped by the API's own types. The tests do what
 * a visitor does and assert on what a visitor sees.
 */
import type { AccuracyResponse, DeliveryDayResponse } from "@cz-epf/api";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { App, OPENING_DAY } from "./App.tsx";
import { REPOSITORY_URL } from "./Footer.tsx";

const hours = Array.from({ length: 24 }, (_, i) => i);

const day: DeliveryDayResponse = {
  deliveryDate: OPENING_DAY,
  // Period ordinal 14 cleared negative.
  observed: hours.map((h) => (h === 13 ? -138.75 : 60 + h)),
  forecasts: [
    { model: "chronos2", prices: hours.map((h) => 62 + h) },
    { model: "ar168", prices: hours.map((h) => 65 + h) },
    { model: "daylag", prices: hours.map((h) => 70.5 + h) },
  ],
  metrics: [
    {
      model: "chronos2",
      mae: 12.345,
      rmse: 20.04,
      smape: 18.75,
      rmae: 0.61234,
    },
    { model: "ar168", mae: 15.05, rmse: 22.5, smape: 21.25, rmae: 0.7525 },
    { model: "daylag", mae: 20, rmse: 30, smape: 25, rmae: 1 },
  ],
};

const accuracy: AccuracyResponse = {
  rows: [
    { model: "chronos2", mae: 16.64, rmse: 30.1, smape: 20.2, rmae: 0.638 },
    { model: "ar168", mae: 20.114, rmse: 34.2, smape: 23.8, rmae: 0.77115 },
    { model: "daylag", mae: 26.083, rmse: 44.8, smape: 32.0, rmae: 1 },
  ],
};

const payloads: Record<string, unknown> = {
  [`/api/days/${OPENING_DAY}`]: day,
  "/api/accuracy": accuracy,
};

const fetchStub = vi.fn((input: string) =>
  Promise.resolve(
    input in payloads
      ? Response.json(payloads[input])
      : new Response(null, { status: 404 }),
  ),
);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchStub);
});

afterEach(() => {
  cleanup();
  fetchStub.mockClear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The headline figure shown for a model: the definition after its term. */
function headline(model: string): string {
  const term = screen
    .getAllByRole("term")
    .find((t) => t.textContent?.startsWith(model));
  return term?.nextElementSibling?.textContent ?? "";
}

describe("the Day view", () => {
  test("draws the day as one labelled chart", async () => {
    render(<App />);

    const chart = await screen.findByRole("img");
    expect(chart.getAttribute("aria-label")).toBe(
      `${OPENING_DAY}: the observed price and the forecasts of Chronos-2, AR-168, Naïve, in EUR/MWh, by period ordinal 1 to 24.`,
    );
    for (const label of ["Observed", "Chronos-2", "AR-168", "Naïve"]) {
      expect(within(chart).getByText(label)).toBeTruthy();
    }
    expect(within(chart).queryByText("daylag")).toBeNull();
  });

  test("the headline numbers show every model for the day, to the metric's precision", async () => {
    render(<App />);
    await screen.findByRole("img");

    expect(headline("Chronos-2")).toBe("12.3 EUR/MWh");
    expect(headline("AR-168")).toBe("15.1 EUR/MWh");
    expect(headline("Naïve")).toBe("20.0 EUR/MWh");
  });

  test("the metric selector governs the headline numbers, rMAE rendering bare", async () => {
    render(<App />);
    await screen.findByRole("img");
    const selector = screen.getByRole("group", { name: "Metric" });

    fireEvent.click(within(selector).getByRole("button", { name: "rMAE" }));

    expect(
      within(selector)
        .getByRole("button", { name: "rMAE" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(headline("Chronos-2")).toBe("0.612");
    expect(headline("Naïve")).toBe("1.000");

    fireEvent.click(within(selector).getByRole("button", { name: "SMAPE" }));
    expect(headline("AR-168")).toBe("21.3");
  });

  test("offers all four metrics and nothing else", () => {
    render(<App />);

    const buttons = within(
      screen.getByRole("group", { name: "Metric" }),
    ).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "MAE",
      "RMSE",
      "SMAPE",
      "rMAE",
    ]);
  });

  test("the crosshair reads out every series at the hovered period, negative prices as cleared", async () => {
    render(<App />);
    const chart = await screen.findByRole("img");

    const column = chart.querySelector('[data-ordinal="14"]');
    if (!column) throw new Error("no column for period ordinal 14");
    fireEvent.mouseEnter(column);

    const tooltip = screen.getByText("Period 14").parentElement;
    expect(tooltip?.textContent).toContain("Observed-138.75");
    expect(tooltip?.textContent).toContain("Chronos-275.00");
    expect(tooltip?.textContent).toContain("AR-16878.00");
    expect(tooltip?.textContent).toContain("Naïve83.50");

    fireEvent.mouseLeave(chart);
    expect(screen.queryByText("Period 14")).toBeNull();
  });

  test("changing the metric fetches nothing new", async () => {
    render(<App />);
    await screen.findByRole("img");
    const calls = fetchStub.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "RMSE" }));

    expect(fetchStub.mock.calls.length).toBe(calls);
  });
});

describe("the accuracy table", () => {
  test("is a semantic table of every model against four metrics", async () => {
    render(<App />);

    const table = await screen.findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Model", "MAE", "RMSE", "SMAPE", "rMAE"]);
    const naive = within(table).getByRole("rowheader", { name: "Naïve" });
    expect(naive.parentElement?.textContent).toBe("Naïve26.144.832.01.000");
  });
});

describe("the page", () => {
  test("carries the ENTSO-E attribution and the repository link", () => {
    render(<App />);

    const footer = screen.getByRole("contentinfo");
    expect(footer.textContent).toContain(
      "Electricity price data sourced from the ENTSO-E Transparency Platform",
    );
    expect(footer.textContent).toContain(
      "ENTSO-E does not endorse this project",
    );
    expect(within(footer).getByRole("link", { name: /GitHub/ })).toHaveProperty(
      "href",
      REPOSITORY_URL,
    );
  });

  test("fetches once and never again, however long the tab stays open", async () => {
    vi.useFakeTimers();
    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });

    expect(fetchStub.mock.calls.map(([path]) => path).sort()).toEqual([
      "/api/accuracy",
      `/api/days/${OPENING_DAY}`,
    ]);
  });

  test("says nothing it does not need to: no disclaimer, no banner", async () => {
    render(<App />);
    await screen.findByRole("img");

    const text = document.body.textContent?.toLowerCase() ?? "";
    for (const word of ["disclaimer", "backtest", "methodology", "not live"]) {
      expect(text).not.toContain(word);
    }
  });
});
