/**
 * Seam 4 for the shell: the real App rendered in a DOM, with only the network
 * stubbed, answering with payloads shaped by the API's own types.
 */
import type { AccuracyResponse } from "@cz-epf/api";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { App } from "./App.tsx";
import { REPOSITORY_URL } from "./Footer.tsx";

const accuracy: AccuracyResponse = {
  rows: [
    { model: "ar168", mae: 20.114, rmse: 34.2, smape: 23.8, rmae: 0.77115 },
    { model: "daylag", mae: 26.083, rmse: 44.8, smape: 32.0, rmae: 1 },
  ],
};

const fetchStub = vi.fn((input: string) =>
  Promise.resolve(
    input === "/api/accuracy"
      ? Response.json(accuracy)
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

describe("the dashboard shell", () => {
  test("renders what the API returns, the naïve labelled Naïve", async () => {
    render(<App />);

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows.map((r) => r.textContent)).toEqual([
      "ModelMAErMAE",
      "AR-16820.10.771",
      "Naïve26.11.000",
    ]);
  });

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

    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
