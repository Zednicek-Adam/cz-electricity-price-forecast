/**
 * The zoom the two Over time charts share (ADR-0019): a span of scored
 * delivery days both draw instead of the whole record, so a season or a week
 * can be read at full width.
 *
 * Dragging across either chart zooms both to the days it covered, and a
 * double-click goes back to the whole record. That is a mouse-only
 * accelerator, as the ribbon is (ADR-0009). The zoom bar under each chart is
 * its accessible form: two native date inputs and a reset button.
 */
import { useState, type MouseEvent } from "react";

import type { DeliveryDate } from "./types.ts";

/** The first and last delivery day drawn; null draws every day. */
export type Zoom = { from: DeliveryDate; to: DeliveryDate } | null;

/** The fewest days a drag must cover to zoom, so a click never does. */
const MIN_DAYS = 3;

/** The first and last index of `days` inside the zoom. */
export function zoomRange(days: DeliveryDate[], zoom: Zoom): [number, number] {
  const last = days.length - 1;
  if (!zoom || last < 0) return [0, Math.max(last, 0)];
  const first = days.findIndex((d) => d >= zoom.from);
  const end = days.findLastIndex((d) => d <= zoom.to);
  if (first === -1 || end === -1 || end < first) return [0, last];
  return [first, end];
}

/**
 * A chart's hover and drag over its drawn days. `indexAt` turns a pointer
 * event into the index of the day under it, or null. Returns the hovered
 * index, the drag's anchor while one is in progress, and the svg's handlers.
 */
export function useDragZoom(
  days: DeliveryDate[],
  indexAt: (event: MouseEvent<SVGSVGElement>) => number | null,
  onZoom: (zoom: Zoom) => void,
) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);

  const handlers = {
    onMouseMove: (event: MouseEvent<SVGSVGElement>) => {
      setHovered(indexAt(event));
    },
    onMouseDown: (event: MouseEvent<SVGSVGElement>) => {
      if (event.button !== 0) return;
      const index = indexAt(event);
      if (index === null) return;
      event.preventDefault();
      setAnchor(index);
    },
    onMouseUp: (event: MouseEvent<SVGSVGElement>) => {
      const index = indexAt(event);
      if (anchor !== null && index !== null) {
        const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
        const from = days[a];
        const to = days[b];
        if (b - a + 1 >= MIN_DAYS && from && to) onZoom({ from, to });
      }
      setAnchor(null);
    },
    onMouseLeave: () => {
      setHovered(null);
      setAnchor(null);
    },
    onDoubleClick: () => onZoom(null),
  };

  return { hovered, anchor, handlers };
}

interface SelectionProps {
  from: number;
  to: number;
  x: (index: number) => number;
  top: number;
  bottom: number;
}

/** The span a drag in progress covers. */
export function Selection({ from, to, x, top, bottom }: SelectionProps) {
  const left = x(Math.min(from, to));
  return (
    <rect
      className="zoom-selection"
      x={left}
      y={top}
      width={Math.max(x(Math.max(from, to)) - left, 1)}
      height={bottom - top}
      pointerEvents="none"
    />
  );
}

interface BarProps {
  /** Every scored delivery day: the most the zoom can cover. */
  days: DeliveryDate[];
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
}

/** The zoom's accessible form, under each Over time chart. */
export function ZoomBar({ days, zoom, onZoom }: BarProps) {
  const first = days[0] ?? "";
  const last = days.at(-1) ?? "";
  const from = zoom?.from ?? first;
  const to = zoom?.to ?? last;

  function pick(next: { from: DeliveryDate; to: DeliveryDate }): void {
    if (!next.from || !next.to || next.from > next.to) return;
    if (next.from < first || next.to > last) return;
    onZoom(next.from === first && next.to === last ? null : next);
  }

  return (
    <div className="zoom-bar">
      <p className="subtle">
        Drag across a chart to zoom · double-click to reset
      </p>
      <div className="zoom" role="group" aria-label="Zoom">
        <input
          type="date"
          aria-label="Zoom from"
          value={from}
          min={first}
          max={to}
          onChange={(event) => pick({ from: event.target.value, to })}
        />
        <span aria-hidden="true">–</span>
        <input
          type="date"
          aria-label="Zoom to"
          value={to}
          min={from}
          max={last}
          onChange={(event) => pick({ from, to: event.target.value })}
        />
        <button type="button" disabled={!zoom} onClick={() => onZoom(null)}>
          Reset zoom
        </button>
      </div>
    </div>
  );
}
