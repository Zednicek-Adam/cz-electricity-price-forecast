/**
 * A segmented switch: a labelled group of native toggle buttons, exactly one
 * pressed. Every choice on the page that picks one of a few — the metric, the
 * chart's history, the scoreboard's scope, the Diebold–Mariano model — is one
 * of these, so they all
 * look and behave alike.
 */
interface Props<T extends string> {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  name: (value: T) => string;
  size?: "regular" | "small" | undefined;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  name,
  size = "regular",
}: Props<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={size === "small" ? "segmented segmented-small" : "segmented"}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {name(option)}
        </button>
      ))}
    </div>
  );
}
