/**
 * Each metric's formula, drawn in MathML so the four can be told apart at a
 * glance: the bars of MAE, the square and root of RMSE, the fraction of
 * SMAPE, the ratio of rMAE (ADR-0020). The variables are words: "error" for
 * an hour's real price minus its forecast, the key line above the list says
 * so, and "real" and "forecast" where SMAPE needs them apart. Each average
 * is one sum over the number of hours, so a newcomer reads "this divided by
 * this" rather than 1/n.
 *
 * A restatement for a general reader: CONTEXT.md stays the definition of
 * record, and where the two disagree this file is the one that is wrong
 * (ADR-0006). SMAPE's rule for a zero price and rMAE's undefined case are
 * left to docs/reading-the-figures.md.
 */
import type { Metric } from "./types.ts";

/* The colours of step 4 of the schema: the real price black, the forecast
 * blue, the error between them red (ADR-0020). */
const REAL = <mtext className="term-real">real</mtext>;
const FORECAST = <mtext className="term-forecast">forecast</mtext>;
const HOURS = <mtext>hours</mtext>;
const ERROR = <mtext className="term-error">error</mtext>;
const SUM = <mo>∑</mo>;

/** |…| as one group, so its bars hug what they hold rather than being
 * spaced as operators between neighbours. */
function abs(inside: React.JSX.Element) {
  return (
    <mrow>
      <mo form="prefix">|</mo>
      {inside}
      <mo form="postfix">|</mo>
    </mrow>
  );
}

/** A sum over the hours, divided by how many there are. */
function average(summed: React.JSX.Element) {
  return (
    <mfrac>
      <mrow>
        {SUM}
        {summed}
      </mrow>
      {HOURS}
    </mfrac>
  );
}

const FORMULAS: Record<Metric, React.JSX.Element> = {
  mae: average(abs(ERROR)),
  rmse: (
    <msqrt>
      {average(
        <msup>
          {ERROR}
          <mn>2</mn>
        </msup>,
      )}
    </msqrt>
  ),
  smape: (
    <mfrac>
      <mrow>
        <mn>200</mn>
        <mo>×</mo>
        {SUM}
        <mfrac>
          {abs(ERROR)}
          <mrow>
            {abs(REAL)}
            <mo>+</mo>
            {abs(FORECAST)}
          </mrow>
        </mfrac>
      </mrow>
      {HOURS}
    </mfrac>
  ),
  rmae: (
    <mfrac>
      <mtext>MAE</mtext>
      <msub>
        <mtext>MAE</mtext>
        <mtext>naïve</mtext>
      </msub>
    </mfrac>
  ),
};

export function MetricFormula({ metric }: { metric: Metric }) {
  return (
    <div className="formula">
      <math data-metric={metric}>{FORMULAS[metric]}</math>
    </div>
  );
}
