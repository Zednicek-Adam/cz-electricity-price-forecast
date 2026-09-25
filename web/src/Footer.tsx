/**
 * The footer every view carries. The attribution and the no-endorsement line
 * are issue #20's obligations for any page rendering the price series, and
 * they are persistent: not a modal, not a tooltip. The repository link is the
 * one path from a figure on screen to its definition (ADR-0006).
 */
export const REPOSITORY_URL =
  "https://github.com/Zednicek-Adam/cz-electricity-price-forecast";

export function Footer() {
  return (
    <footer>
      <p>
        Electricity price data sourced from the{" "}
        <a href="https://transparency.entsoe.eu/">
          ENTSO-E Transparency Platform
        </a>
        . ENTSO-E does not endorse this project and is not responsible for its
        content or for any forecasts derived from the data.
      </p>
      <p>
        <a href={REPOSITORY_URL}>Source and definitions on GitHub</a>
      </p>
    </footer>
  );
}
