/**
 * The help popover (ADR-0020): a "How to read" link beside a title that
 * opens, on click, a short plain-language note on how to read what the title
 * names. It is a button dressed as a link (ADR-0021), and its accessible name
 * is the note's, so a screen reader hears what it explains.
 * Click rather than hover, so it works on a phone. It is non-modal: Escape
 * or a click outside closes it, and Escape returns focus to the button.
 *
 * The note stays in the document while closed, hidden, so the button can
 * name what it controls. Open, it is placed against the viewport rather than
 * its card, because the hero cards clip what overflows them: under the
 * button, kept on screen, and above it when there is no room below.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { MetricFormula } from "./MetricFormula.tsx";
import { METRIC_PRESENTATION, METRICS } from "./presentation.ts";

/** The gap between the note and the button, and the note and the screen. */
const GAP = 8;
const EDGE = 12;

interface Props {
  /** The button's accessible name, and the note's: "How to read …". */
  label: string;
  children: ReactNode;
}

export function Help({ label, children }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!open) return;
    function measure(): void {
      const at = button.current?.getBoundingClientRect();
      const note = panel.current?.getBoundingClientRect();
      if (!at || !note) return;
      const left = Math.max(
        EDGE,
        Math.min(at.left - 10, window.innerWidth - note.width - EDGE),
      );
      const below = at.bottom + GAP;
      const fits = below + note.height <= window.innerHeight - EDGE;
      const above = at.top - GAP - note.height;
      setPlace({ left, top: fits || above < EDGE ? below : above });
    }
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function away(event: PointerEvent): void {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    }
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <span className="help" ref={root}>
      <button
        ref={button}
        type="button"
        className="help-button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        How to read
      </button>
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-label={label}
        className="help-panel"
        style={place}
        hidden={!open}
      >
        {children}
      </div>
    </span>
  );
}

/** The introduction's four metrics, each with its formula and what it
 * means, after a key to the formulas. */
export function MetricList({ className }: { className: string }) {
  return (
    <>
      <p className="formula-key">
        For each hour, the <span className="term-error">error</span> is the{" "}
        <span className="term-real">real</span> price minus the{" "}
        <span className="term-forecast">forecast</span>. ∑ adds up every hour.
        Lower is better in all four.
      </p>
      <dl className={className}>
        {METRICS.map((m) => (
          <div key={m}>
            <dt>{METRIC_PRESENTATION[m].label}</dt>
            <dd>
              <MetricFormula metric={m} />
              {METRIC_PRESENTATION[m].plain}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** The metric hint: the four metrics in the README's words, no formulas. */
export function MetricGlossary() {
  return (
    <>
      <p>Every figure measures a miss, so lower is better.</p>
      <dl className="metric-glossary">
        {METRICS.map((m) => (
          <div key={m}>
            <dt>{METRIC_PRESENTATION[m].label}</dt>
            <dd>{METRIC_PRESENTATION[m].described}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
