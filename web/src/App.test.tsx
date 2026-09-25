/**
 * Seam 4: the real dashboard rendered in a DOM, with real visx, stubbing only
 * the network with payloads shaped by the API's own types (`fixture.ts`). The
 * tests do what a visitor does and assert on what a visitor sees.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { forgetResponses } from "./api.ts";
import { App, OPENING_DAY } from "./App.tsx";
import { payloadFor } from "./fixture.ts";
import { REPOSITORY_URL } from "./Footer.tsx";

const fetchStub = vi.fn((path: string) => {
  const payload = payloadFor(path);
  return Promise.resolve(
    payload === undefined
      ? new Response(null, { status: 404 })
      : Response.json(payload),
  );
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchStub);
});

afterEach(() => {
  cleanup();
  forgetResponses();
  fetchStub.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const requested = () => fetchStub.mock.calls.map(([path]) => path);

/** The headline figure shown for a model: the definition after its term. */
function headline(model: string): string {
  const term = screen
    .getAllByRole("term")
    .find((t) => t.textContent?.startsWith(model));
  return term?.nextElementSibling?.textContent ?? "";
}

function click(name: string | RegExp): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

async function heroTitle(text: string): Promise<void> {
  await screen.findByRole("heading", { level: 2, name: text });
}

/** The Day view, loaded, with the day's figures on screen. */
async function openDay(): Promise<void> {
  render(<App />);
  await screen.findByRole("img", { name: new RegExp(`^${OPENING_DAY}`) });
  await screen.findByRole("button", {
    name: "Worst day",
    disabled: false,
  } as never);
}

describe("the Day view", () => {
  test("draws the day as one labelled chart, the naïve called Naïve", async () => {
    await openDay();

    const chart = screen.getByRole("img", {
      name: new RegExp(`^${OPENING_DAY}`),
    });
    expect(chart.getAttribute("aria-label")).toBe(
      `${OPENING_DAY}: the observed price and the forecasts of Chronos-2, AR-168, Naïve, in EUR/MWh, by period ordinal 1 to 24.`,
    );
    for (const label of ["Observed", "Chronos-2", "AR-168", "Naïve"]) {
      expect(within(chart).getByText(label)).toBeTruthy();
    }
    expect(within(chart).queryByText("daylag")).toBeNull();
  });

  test("the headline numbers show every model for the day, to the metric's precision", async () => {
    await openDay();

    expect(headline("Chronos-2")).toBe("15.0 EUR/MWh");
    expect(headline("AR-168")).toBe("15.1 EUR/MWh");
    expect(headline("Naïve")).toBe("20.0 EUR/MWh");
  });

  test("the metric selector governs the headline numbers, rMAE rendering bare", async () => {
    await openDay();
    const selector = screen.getByRole("group", { name: "Metric" });

    fireEvent.click(within(selector).getByRole("button", { name: "rMAE" }));

    expect(
      within(selector)
        .getByRole("button", { name: "rMAE" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(headline("Chronos-2")).toBe("0.600");
    expect(headline("Naïve")).toBe("1.000");
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
    await openDay();
    const chart = screen.getByRole("img", {
      name: new RegExp(`^${OPENING_DAY}`),
    });

    const column = chart.querySelector('[data-ordinal="14"]');
    if (!column) throw new Error("no column for period ordinal 14");
    fireEvent.mouseEnter(column);

    const tooltip = screen.getByText("Period 14").parentElement;
    expect(tooltip?.textContent).toContain("Observed-138.75");
    expect(tooltip?.textContent).toContain("Naïve113.50");

    fireEvent.mouseLeave(chart);
    expect(screen.queryByText("Period 14")).toBeNull();
  });
});

describe("the day navigator", () => {
  test("the stepper walks one delivery day at a time, and stops at the record's end", async () => {
    await openDay();
    expect(
      screen.getByRole("button", { name: "Next delivery day" }),
    ).toHaveProperty("disabled", true);

    click("Previous delivery day");

    await heroTitle("2024-12-30");
    await screen.findByRole("img", { name: /^2024-12-30/ });
    expect(headline("Chronos-2")).toBe("20.0 EUR/MWh");
  });

  test("worst day lands on the fixture's worst day for the selected metric", async () => {
    await openDay();

    click("Worst day");
    await heroTitle("2024-12-28");

    click("rMAE");
    await screen.findByRole("button", {
      name: "Worst day",
      disabled: false,
    } as never);
    await act(async () => {
      await Promise.resolve();
    });
    click("Worst day");
    await heroTitle("2024-12-30");
  });

  test("best day and random land where they should", async () => {
    await openDay();

    click("Best day");
    await heroTitle("2024-12-29");

    vi.spyOn(Math, "random").mockReturnValue(0.3);
    click("Random");
    await heroTitle("2024-12-28");
  });

  test("clicking the ribbon jumps the Day view to that day", async () => {
    const { container } = render(<App />);
    await screen.findByRole("img", { name: new RegExp(`^${OPENING_DAY}`) });
    const column = await vi.waitFor(() => {
      const found = container.querySelector('[data-day="2024-12-29"]');
      if (!found) throw new Error("no ribbon yet");
      return found;
    });

    fireEvent.click(column);

    await heroTitle("2024-12-29");
    await screen.findByRole("img", { name: /^2024-12-29/ });
  });

  test("the stepper and the three buttons are native controls; the ribbon is not in the accessibility tree", async () => {
    const { container } = render(<App />);
    await screen.findByRole("button", {
      name: "Worst day",
      disabled: false,
    } as never);

    for (const name of [
      "Previous delivery day",
      "Next delivery day",
      "Worst day",
      "Best day",
      "Random",
    ]) {
      expect(screen.getByRole("button", { name }).tagName).toBe("BUTTON");
    }
    const ribbon = container.querySelector(".ribbon");
    expect(ribbon?.getAttribute("aria-hidden")).toBe("true");
    expect(ribbon?.querySelector("[tabindex]")).toBeNull();
    expect(
      screen.getAllByRole("img").every((img) => !ribbon?.contains(img)),
    ).toBe(true);
  });
});

describe("the Over time view", () => {
  test("switches in place, and the headline numbers reframe to the whole record", async () => {
    await openDay();
    expect(headline("Chronos-2")).toBe("15.0 EUR/MWh");

    click("Over time");

    await heroTitle("MAE over time");
    const chart = await screen.findByRole("img", { name: /^Running MAE/ });
    expect(headline("Chronos-2")).toBe("16.6 EUR/MWh");
    expect(within(chart).queryByText("Observed")).toBeNull();
    expect(within(chart).getByText("2024")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Worst day" })).toBeNull();
  });

  test("follows the metric selector, and back in the Day view so does the navigator", async () => {
    await openDay();
    click("Over time");
    await screen.findByRole("img", { name: /^Running MAE/ });

    click("rMAE");

    await screen.findByRole("img", { name: /^Running rMAE/ });
    expect(headline("Naïve")).toBe("1.000");
    expect(requested()).toContain("/api/running/rmae");

    click("Day");
    await screen.findByRole("button", {
      name: "Worst day",
      disabled: false,
    } as never);
    await vi.waitFor(() => expect(requested()).toContain("/api/daily/rmae"));
  });
});

describe("the accuracy table", () => {
  test("is a semantic table of every model against four metrics, the naïve at 1.000", async () => {
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

describe("the Diebold–Mariano card", () => {
  test("plots the selected model against both opponents, with ±1.96 lines", async () => {
    render(<App />);

    const chart = await screen.findByRole("img", { name: /^Diebold–Mariano/ });
    expect(chart.getAttribute("aria-label")).toBe(
      "Diebold–Mariano statistic of Chronos-2 against AR-168 and Naïve, by period ordinal 1 to 24, with reference lines at plus and minus 1.96.",
    );
    expect(chart.querySelectorAll("line.reference")).toHaveLength(2);
    expect(within(chart).getByText("1.96")).toBeTruthy();
    expect(within(chart).getByText("-1.96")).toBeTruthy();
  });

  test("choosing another model tests it against its own opponents", async () => {
    render(<App />);
    await screen.findByRole("img", { name: /^Diebold–Mariano/ });

    fireEvent.click(
      within(screen.getByRole("group", { name: "Model" })).getByRole("button", {
        name: "AR-168",
      }),
    );

    await screen.findByRole("img", {
      name: /^Diebold–Mariano statistic of AR-168 against Chronos-2 and Naïve/,
    });
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

  test("fetches each payload once and never again, however long the tab stays open", async () => {
    vi.useFakeTimers();
    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });

    expect([...requested()].sort()).toEqual([
      "/api/accuracy",
      "/api/comparisons/chronos2",
      "/api/daily/mae",
      `/api/days/${OPENING_DAY}`,
    ]);
  });

  test("going back to a view already seen costs no request", async () => {
    await openDay();
    click("Over time");
    await screen.findByRole("img", { name: /^Running MAE/ });
    const before = requested().length;

    click("Day");
    await screen.findByRole("img", { name: new RegExp(`^${OPENING_DAY}`) });
    click("Over time");
    await screen.findByRole("img", { name: /^Running MAE/ });

    expect(requested().length).toBe(before);
  });

  test("says nothing it does not need to: no disclaimer, no banner", async () => {
    await openDay();

    const text = document.body.textContent?.toLowerCase() ?? "";
    for (const word of ["disclaimer", "backtest", "methodology", "not live"]) {
      expect(text).not.toContain(word);
    }
  });
});
