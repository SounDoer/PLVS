export function DockExpandedMetric({ label, value, unit, align = "start", indicator = null }) {
  const showUnit = Boolean(unit) && value !== "-";
  const alignment =
    align === "end"
      ? "items-end text-right"
      : align === "center"
        ? "items-center text-center"
        : "items-start text-left";

  return (
    <div data-testid="dock-expanded-metric" className={`flex min-w-0 flex-col ${alignment}`}>
      <span className="flex max-w-full items-center gap-[var(--ui-dock-gap-column)] overflow-hidden font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-label)] font-medium leading-none text-muted-foreground">
        {indicator}
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <span className="mt-1 flex max-w-full items-baseline gap-[var(--ui-dock-gap-column)] whitespace-nowrap leading-none">
        <span className="font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-dock-fs-value)] font-semibold tabular-nums text-foreground">
          {value}
        </span>
        {showUnit ? (
          <span
            data-testid="dock-expanded-metric-unit"
            className="font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-caption)] font-medium text-muted-foreground"
          >
            {unit}
          </span>
        ) : null}
      </span>
    </div>
  );
}
