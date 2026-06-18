import { cn } from "@/lib/utils";
import { HoverTip } from "@/components/HoverTip";

/**
 * A small icon-only button with an optional tooltip.
 *
 * @param {{
 *   icon: import("react").ReactNode,
 *   tip?: string,
 *   disabled?: boolean,
 *   onClick?: () => void,
 *   className?: string,
 *   "aria-label"?: string,
 * }} props
 */
export function IconButton({
  icon,
  tip,
  disabled = false,
  onClick,
  className,
  "aria-label": ariaLabel,
}) {
  return (
    <HoverTip tip={tip} side="bottom">
      <button
        type="button"
        aria-label={ariaLabel ?? tip}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "flex items-center justify-center size-8 rounded-md",
          "text-muted-foreground bg-transparent",
          "transition-colors duration-[120ms]",
          disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-secondary hover:text-foreground",
          className
        )}
      >
        {icon}
      </button>
    </HoverTip>
  );
}
