import { cn } from "@/lib/utils";
import { useHoverTip } from "@/components/HoverTip";
import { IconAction } from "@/components/ui/icon-action";

export const MANAGEMENT_ROW_CLASS =
  "group flex min-h-[var(--ui-row-h)] w-full items-center gap-2 rounded-xs px-2 text-[length:var(--ui-fs-control)] hover:bg-ui-hover focus-within:bg-ui-hover";

export const MANAGEMENT_ROW_ACTIONS_CLASS =
  "flex shrink-0 items-center gap-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";

/**
 * @param {{
 *   label: string,
 *   icon: import("react").ReactNode,
 *   onClick: (...args: any[]) => any,
 *   className?: string,
 *   disabled?: boolean,
 *   tip?: string,
 *   tipSide?: "top" | "bottom" | "left" | "right",
 *   tipAlign?: "start" | "center" | "end",
 * }} props
 */
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
      <IconAction
        ref={anchorRef}
        aria-label={label}
        disabled={disabled}
        className={cn("p-1 disabled:pointer-events-none disabled:opacity-50", className)}
        onClick={onClick}
        onMouseEnter={tip ? showTip : undefined}
        onMouseLeave={tip ? hideTip : undefined}
        onFocus={tip ? showTip : undefined}
        onBlur={tip ? hideTip : undefined}
      >
        {icon}
      </IconAction>
      {tipNode}
    </>
  );
}
