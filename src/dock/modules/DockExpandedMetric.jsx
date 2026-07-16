const UNIT_VISIBILITY_CLASSES = {
  default: "@max-[84px]:hidden",
  tight: "@max-[68px]:hidden",
};

export function DockExpandedMetric({
  label,
  value,
  unit,
  align = "start",
  indicator = null,
  unitVisibility = "default",
}) {
  const showUnit = Boolean(unit) && value !== "-";
  const unitVisibilityClass =
    UNIT_VISIBILITY_CLASSES[unitVisibility] ?? UNIT_VISIBILITY_CLASSES.default;
  const alignment =
    align === "end"
      ? "items-end text-right"
      : align === "center"
        ? "items-center text-center"
        : "items-start text-left";

  return (
    <div
      data-testid="dock-expanded-metric"
      className={`@container flex min-w-0 flex-col overflow-hidden ${alignment}`}
    >
      <span className="flex max-w-full items-center gap-[var(--ui-dock-gap-column)] overflow-hidden font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-label)] font-medium leading-none text-muted-foreground">
        {indicator}
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <span className="mt-1 flex min-w-0 max-w-full items-baseline gap-[var(--ui-dock-gap-column)] overflow-hidden whitespace-nowrap leading-none">
        <span className="shrink-0 font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-dock-fs-value)] font-semibold tabular-nums text-foreground">
          {value}
        </span>
        {showUnit ? (
          <span
            data-testid="dock-expanded-metric-unit"
            className={`shrink-0 font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-caption)] font-medium text-muted-foreground ${unitVisibilityClass}`}
          >
            {unit}
          </span>
        ) : null}
      </span>
    </div>
  );
}
