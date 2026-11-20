/**
 * The introduction (ADR-0020): what forecasting a day-ahead price means, for
 * a reader who has never met the market, and how this page keeps score. It
 * explains the idea, not the project's build; that is the README's job. The
 * idea is a schema rather than prose. Below it, the three models and the
 * four metrics are named, each with its formula. It carries no figure from
 * the record: the charts below are where the models' accuracy is read.
 *
 * It folds to one bar, and the page remembers the fold, so a returning
 * reader meets the chart first.
 */
import { useState } from "react";

import { MetricList } from "./Help.tsx";
import { IntroSchema } from "./IntroSchema.tsx";
import { LineKey } from "./Legend.tsx";
import { MODEL_LABELS } from "./presentation.ts";
import type { ModelSlug } from "./types.ts";

export const INTRO_FOLDED_KEY = "cz-epf:intro-folded";

/** Storage can be missing or refuse writes, as in a private window; the
 * introduction then opens on every visit, which is the safe default. */
function readFolded(): boolean {
  try {
    return localStorage.getItem(INTRO_FOLDED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeFolded(folded: boolean): void {
  try {
    if (folded) localStorage.setItem(INTRO_FOLDED_KEY, "1");
    else localStorage.removeItem(INTRO_FOLDED_KEY);
  } catch {
    // The fold still holds for this visit.
  }
}

const MODELS: { model: ModelSlug; about: string }[] = [
  {
    model: "chronos2",
    about:
      "An AI model from Amazon, pretrained on a large mix of time series. Nobody tuned it for Czech prices. It reads their recent history and continues the pattern. It is the model this page leads with.",
  },
  {
    model: "ar168",
    about:
      "A classic statistical model. Every day it refits itself on the last two years of prices, then predicts each hour from the week of hourly prices before it. A week has 168 hours, hence the name.",
  },
  {
    model: "daylag",
    about:
      "Not much of a model. It assumes each hour will cost what it cost the day before. It is the yardstick: a forecast that cannot beat it is not worth much.",
  },
];

export function Intro() {
  const [folded, setFolded] = useState(readFolded);

  function fold(next: boolean): void {
    setFolded(next);
    writeFolded(next);
  }

  if (folded) {
    return (
      <section className="card intro intro-folded" aria-label="Introduction">
        <button
          type="button"
          className="fold-bar"
          aria-expanded={false}
          aria-controls="intro-body"
          onClick={() => fold(false)}
        >
          <span className="intro-mark" aria-hidden="true">
            ?
          </span>
          <span className="fold-summary">
            New here? How electricity price forecasting works
          </span>
          <span className="fold-action">
            <span className="chevron" aria-hidden="true" />
            Show
          </span>
        </button>
        <div id="intro-body" hidden />
      </section>
    );
  }

  return (
    <section className="card intro" aria-labelledby="intro-title">
      <div className="intro-bar">
        <div>
          <p className="eyebrow">New here?</p>
          <h2 id="intro-title">How electricity price forecasting works</h2>
        </div>
        <button
          type="button"
          className="fold"
          aria-expanded={true}
          aria-controls="intro-body"
          onClick={() => fold(true)}
        >
          <span className="chevron" aria-hidden="true" />
          Hide
        </button>
      </div>
      <div id="intro-body" className="intro-body">
        <IntroSchema />

        <div className="intro-columns">
          <div>
            <h3>The three models</h3>
            <dl className="intro-models">
              {MODELS.map(({ model, about }) => (
                <div key={model}>
                  <dt>
                    <LineKey series={model} />
                    {MODEL_LABELS[model]}
                  </dt>
                  <dd>{about}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h3>How the forecasts are scored</h3>
            <MetricList className="intro-metrics" />
          </div>
        </div>
      </div>
    </section>
  );
}
