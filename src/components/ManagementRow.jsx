import { cn } from "@/lib/utils";
import { useHoverTip } from "@/components/HoverTip";

export const MANAGEMENT_ROW_CLASS =
  "group flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-[length:var(--ui-fs-control)] transition-colors hover:bg-muted/50 focus-within:bg-muted/50";

export const MANAGEMENT_ROW_ACTIONS_CLASS =
  "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100";

export function ManagementIconAction({
  label,
  icon,
  onClick,
  className,
  disabled = false,
  tip,
  tipSide = "top",
  tipAlign = "center",
}) {
  const { anchorRef, showTip, hideTip, tipNode } = useHoverTip({
    tip,
    side: tipSide,
    align: tipAlign,
  });

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={label}
        disabled={disabled}
        className={cn(
          "rounded-xs p-0.5 text-muted-foreground opacity-70 transition-colors hover:text-foreground hover:opacity-100 disabled:pointer-events-none disabled:opacity-30",
          className
        )}
        onClick={onClick}
        onMouseEnter={tip ? showTip : undefined}
        onMouseLeave={tip ? hideTip : undefined}
        onFocus={tip ? showTip : undefined}
        onBlur={tip ? hideTip : undefined}
      >
        {icon}
      </button>
      {tipNode}
    </>
  );
}
