/**
 * Seam 4: the real dashboard rendered in a DOM, with real visx, handed the
 * fixture record (`fixture.ts`) as `main.tsx` hands it the loaded file. The
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
import { afterEach, describe, expect, test, vi } from "vitest";

import { App } from "./App.tsx";
import { loadDashboard } from "./dashboard.ts";
import { DASHBOARD, DASHBOARD_WITH_PENDING, PENDING_DAY } from "./fixture.ts";
import { REPOSITORY_URL } from "./Footer.tsx";
import { formatDay } from "./presentation.ts";

/** The Day view opens on the record's last day. */
const OPENING_DAY = DASHBOARD.record.last;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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

function tab(name: string): void {
  fireEvent.click(screen.getByRole("tab", { name }));
}

async function heroTitle(text: string): Promise<void> {
  await screen.findByRole("heading", { level: 2, name: text });
}

/** The Day view's title: the delivery day, weekday first. */
async function dayTitle(day: string): Promise<void> {
  await heroTitle(formatDay(day));
}

function metricButton(name: string): HTMLElement {
  return within(screen.getByRole("group", { name: "Metric" })).getByRole(
    "button",
    { name },
  );
}

/** The Day view, loaded, with the day's figures on screen. */
async function openDay(): Promise<void> {
  render(<App data={DASHBOARD} />);
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
    render(<App data={DASHBOARD} />);

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

  test("titles the day by its weekday and date", async () => {
    await openDay();

    await heroTitle("Tue 31 Dec 2024");
  });

  test("the metric selector rescores the day and leaves the price chart alone", async () => {
    await openDay();
    const chart = () =>
      screen.getByRole("img", { name: new RegExp(`^${OPENING_DAY}`) });
    const drawn = chart().innerHTML;

    fireEvent.click(metricButton("RMSE"));

    expect(headline("Chronos-2")).toBe("17.0 EUR/MWh");
    expect(chart().innerHTML).toBe(drawn);
    // The selector lives in the day's accuracy panel, not in the chart's bar.
    const panel = screen.getByRole("region", { name: "Day accuracy" });
    expect(within(panel).getByRole("group", { name: "Metric" })).toBeTruthy();
  });

  test("marks the model with the lowest figure as best", async () => {
    await openDay();

    const best = screen
      .getAllByRole("term")
      .filter((t) => t.textContent?.endsWith("Best"));
    expect(best.map((t) => t.textContent)).toEqual(["Chronos-2Best"]);
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

    await dayTitle("2024-12-30");
    await screen.findByRole("img", { name: /^2024-12-30/ });
    expect(headline("Chronos-2")).toBe("20.0 EUR/MWh");
  });

  test("worst day lands on the fixture's worst day for the selected metric", async () => {
    await openDay();

    click("Worst day");
    await dayTitle("2024-12-28");

    click("rMAE");
    await screen.findByRole("button", {
      name: "Worst day",
      disabled: false,
    } as never);
    await act(async () => {
      await Promise.resolve();
    });
    click("Worst day");
    await dayTitle("2024-12-30");
  });

  test("best day and random land where they should", async () => {
    await openDay();

    click("Best day");
    await dayTitle("2024-12-29");

    vi.spyOn(Math, "random").mockReturnValue(0.3);
    click("Random");
    await dayTitle("2024-12-28");
  });

  test("clicking the ribbon jumps the Day view to that day", async () => {
    const { container } = render(<App data={DASHBOARD} />);
    await screen.findByRole("img", { name: new RegExp(`^${OPENING_DAY}`) });
    const column = await vi.waitFor(() => {
      const found = container.querySelector('[data-day="2024-12-29"]');
      if (!found) throw new Error("no ribbon yet");
      return found;
    });

    fireEvent.click(column);

    await dayTitle("2024-12-29");
    await screen.findByRole("img", { name: /^2024-12-29/ });
  });

  test("the stepper and the three buttons are native controls; the ribbon is not in the accessibility tree", async () => {
    const { container } = render(<App data={DASHBOARD} />);
    await screen.findByRole("img", { name: new RegExp(`^${OPENING_DAY}`) });
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

    tab("Over time");

    await heroTitle("MAE over time");
    const chart = await screen.findByRole("img", { name: /^Running MAE/ });
    expect(headline("Chronos-2")).toBe("16.6 EUR/MWh");
    expect(within(chart).queryByText("Observed")).toBeNull();
    expect(within(chart).getByText("2024")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Worst day" })).toBeNull();
  });

  test("its metric selector redraws the chart, and leaves the Day view's own metric alone", async () => {
    await openDay();
    tab("Over time");
    await screen.findByRole("img", { name: /^Running MAE/ });

    fireEvent.click(metricButton("rMAE"));

    await screen.findByRole("img", { name: /^Running rMAE/ });
    await heroTitle("rMAE over time");
    expect(headline("Naïve")).toBe("1.000");

    tab("Day");
    expect(metricButton("MAE").getAttribute("aria-pressed")).toBe("true");
    expect(headline("Chronos-2")).toBe("15.0 EUR/MWh");
    click("Worst day");
    await dayTitle("2024-12-28");
  });
});

describe("the 30-day view", () => {
  test("draws the trailing metric, and the headline numbers reframe to the last 30 days", async () => {
    await openDay();

    tab("30 days");

    await heroTitle("30-day MAE");
    const chart = await screen.findByRole("img", {
      name: /^MAE over the trailing 30 days of Chronos-2, AR-168, Naïve/,
    });
    expect(within(chart).queryByText("Observed")).toBeNull();
    expect(headline("Chronos-2")).toBe("31.8 EUR/MWh");
    expect(headline("AR-168")).toBe("30.2 EUR/MWh");
    expect(
      screen.getByText("Last 30 days · 2023-12-05 – 2024-01-03", {
        selector: ".tiles-caption",
      }),
    ).toBeTruthy();
  });

  test("shares its metric with the Over time view", async () => {
    await openDay();
    tab("30 days");

    fireEvent.click(metricButton("SMAPE"));
    await screen.findByRole("img", {
      name: /^SMAPE over the trailing 30 days/,
    });

    tab("Over time");
    await screen.findByRole("img", { name: /^Running SMAPE/ });
  });
});

describe("the view tabs", () => {
  test("are a tab list with one tab selected, walked with the arrow keys", async () => {
    await openDay();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Day",
      "Over time",
      "30 days",
    ]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    await heroTitle("MAE over time");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Over time" }),
    );

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    await heroTitle("30-day MAE");
  });
});

describe("the pending day", () => {
  test("opens the Day view on the pending forecast, with no observed line and no figures", async () => {
    render(<App data={DASHBOARD_WITH_PENDING} />);

    const chart = await screen.findByRole("img", {
      name: new RegExp(`^${PENDING_DAY}`),
    });
    expect(chart.getAttribute("aria-label")).toBe(
      `${PENDING_DAY}: the forecasts of Chronos-2, AR-168, Naïve, in EUR/MWh, by period ordinal 1 to 24.`,
    );
    expect(within(chart).queryByText("Observed")).toBeNull();
    expect(screen.getByText(/^Not published yet/)).toBeTruthy();
    expect(screen.queryAllByRole("term")).toHaveLength(0);
  });

  test("the latest-forecast chip opens the pending day from anywhere", async () => {
    render(<App data={DASHBOARD_WITH_PENDING} />);
    click("Previous delivery day");
    tab("Over time");
    await heroTitle("MAE over time");

    click(/^Latest forecast/);

    await dayTitle(PENDING_DAY);
  });

  test("says the daily run has stopped once the pending day is no longer ahead", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2025-01-01T09:00:00Z"));
    render(<App data={DASHBOARD_WITH_PENDING} />);

    const warning = await screen.findByRole("status");
    expect(warning.textContent).toBe(
      `The daily run has stopped: the latest forecast is for ${PENDING_DAY}.`,
    );
  });

  test("says nothing while the pending day is still ahead", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-12-31T22:30:00Z")); // 23:30 in Prague
    render(<App data={DASHBOARD_WITH_PENDING} />);

    await screen.findByRole("img", { name: new RegExp(`^${PENDING_DAY}`) });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("the accuracy table", () => {
  test("is a semantic table of every model against four metrics, the naïve at 1.000", async () => {
    render(<App data={DASHBOARD} />);

    const table = await screen.findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Model", "MAE", "RMSE", "SMAPE", "rMAE"]);
    const naive = within(table).getByRole("rowheader", { name: "Naïve" });
    expect(naive.parentElement?.textContent).toBe("Naïve26.144.832.01.000");
  });

  test("sets the lowest figure in each column in bold", async () => {
    render(<App data={DASHBOARD} />);
    const table = await screen.findByRole("table");

    expect(
      Array.from(table.querySelectorAll("td.best")).map((td) => td.textContent),
    ).toEqual(["16.6", "30.1", "20.2", "0.638"]);
  });
});

describe("the scoreboard's scope", () => {
  test("switches the table and the Diebold–Mariano card to the last 30 days together", async () => {
    render(<App data={DASHBOARD} />);
    const whole = (await screen.findByRole("img", { name: /^Diebold–Mariano/ }))
      .innerHTML;

    fireEvent.click(
      within(screen.getByRole("group", { name: "Scope" })).getByRole("button", {
        name: "Last 30 days",
      }),
    );

    const table = screen.getByRole("table");
    const ar168 = within(table).getByRole("rowheader", { name: "AR-168" });
    expect(ar168.parentElement?.textContent).toBe("AR-16830.243.128.40.636");
    expect(
      screen.getByRole("img", { name: /^Diebold–Mariano/ }).innerHTML,
    ).not.toBe(whole);
    expect(
      screen.getByText("Last 30 days · 2023-12-05 – 2024-01-03"),
    ).toBeTruthy();
  });
});

describe("the Diebold–Mariano card", () => {
  test("plots the selected model against both opponents, with ±1.96 lines", async () => {
    render(<App data={DASHBOARD} />);

    const chart = await screen.findByRole("img", { name: /^Diebold–Mariano/ });
    expect(chart.getAttribute("aria-label")).toBe(
      "Diebold–Mariano statistic of Chronos-2 against AR-168 and Naïve, by period ordinal 1 to 24, with reference lines at plus and minus 1.96.",
    );
    expect(chart.querySelectorAll("line.reference")).toHaveLength(2);
    expect(within(chart).getByText("1.96")).toBeTruthy();
    expect(within(chart).getByText("-1.96")).toBeTruthy();
  });

  test("choosing another model tests it against its own opponents", async () => {
    render(<App data={DASHBOARD} />);
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
    render(<App data={DASHBOARD} />);

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

  test("says nothing it does not need to: no disclaimer, no banner", async () => {
    await openDay();

    const text = document.body.textContent?.toLowerCase() ?? "";
    for (const word of ["disclaimer", "backtest", "methodology", "not live"]) {
      expect(text).not.toContain(word);
    }
  });
});

describe("loading the record", () => {
  test("reads /dashboard.json once", async () => {
    const fetchStub = vi.fn(() => Promise.resolve(Response.json(DASHBOARD)));
    vi.stubGlobal("fetch", fetchStub);

    expect(await loadDashboard()).toEqual(DASHBOARD);
    expect(fetchStub.mock.calls).toEqual([["/dashboard.json"]]);
  });

  test("fails loudly when the file is missing", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response(null, { status: 404 })),
    );

    await expect(loadDashboard()).rejects.toThrow("/dashboard.json: 404");
  });
});
