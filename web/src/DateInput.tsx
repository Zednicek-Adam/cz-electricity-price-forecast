/**
 * A native date input a reader can type into. Typing a date fires a change on
 * every keystroke, and most of them are dates the page cannot show: the year
 * 0002 on the way to 2023. Bound straight to the page's state, the input
 * would snap back on each one and no date could be typed. So it keeps what is
 * being typed as a draft, hands every change on for the page to take or
 * ignore, and shows the page's value again once the page moves or the input
 * loses focus.
 */
import { useState } from "react";

import type { DeliveryDate } from "./types.ts";

interface Props {
  label: string;
  value: DeliveryDate;
  min: DeliveryDate;
  max: DeliveryDate;
  onChange: (value: string) => void;
}

export function DateInput({ label, value, min, max, onChange }: Props) {
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setDraft(value);
  }

  return (
    <input
      type="date"
      aria-label={label}
      value={draft}
      min={min}
      max={max}
      onChange={(event) => {
        setDraft(event.target.value);
        onChange(event.target.value);
      }}
      onBlur={() => setDraft(value)}
    />
  );
}
