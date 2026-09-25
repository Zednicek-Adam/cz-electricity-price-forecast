/**
 * The dashboard shell (ADR-0007). At this stage it proves the chain end to
 * end, from the Worker's static assets through the API to Neon and back: it
 * fetches the accuracy table once and renders it. The hero chart and the
 * cards arrive with the views that need them.
 */
import type { AccuracyResponse, ModelSlug } from "@cz-epf/api";
import { useEffect, useState } from "react";

import { getJson } from "./api.ts";
import { Footer } from "./Footer.tsx";

/** How the interface names each model. The benchmark is "Naïve" (ADR-0007). */
export const MODEL_LABELS: Record<ModelSlug, string> = {
  chronos2: "Chronos-2",
  ar168: "AR-168",
  daylag: "Naïve",
};

type Load<T> =
  { state: "loading" } | { state: "ready"; data: T } | { state: "failed" };

export function App() {
  const [accuracy, setAccuracy] = useState<Load<AccuracyResponse>>({
    state: "loading",
  });

  useEffect(() => {
    let current = true;
    getJson<AccuracyResponse>("/api/accuracy")
      .then((data) => current && setAccuracy({ state: "ready", data }))
      .catch(() => current && setAccuracy({ state: "failed" }));
    return () => {
      current = false;
    };
  }, []);

  return (
    <>
      <header>
        <h1>Czech day-ahead electricity prices</h1>
        <p>2020–2024</p>
      </header>
      <main>
        {accuracy.state === "ready" && (
          <table>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">MAE</th>
                <th scope="col">rMAE</th>
              </tr>
            </thead>
            <tbody>
              {accuracy.data.rows.map((row) => (
                <tr key={row.model}>
                  <th scope="row">{MODEL_LABELS[row.model]}</th>
                  <td>{row.mae?.toFixed(1)}</td>
                  <td>{row.rmae?.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
      <Footer />
    </>
  );
}
