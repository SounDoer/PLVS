import { HoverTip } from "@/components/HoverTip";
import { cn } from "@/lib/utils";

export const UNKNOWN_LAYOUT_TIP = "Layout not recognized. Loudness uses channels 1–2 only.";

const WARN_CHIP_BG = "bg-[color:var(--ui-interface-warning)]";
const WARN_CHIP_BORDER = "border border-transparent";

/**
 * Shown wherever loudness is read out while the engine measured Ch1/Ch2 of an unrecognized
 * channel layout. `known` is `loudnessLayoutKnown`; only an explicit `false` shows the marker.
 * `dense` swaps to Dock caption typography for Dock surfaces.
 */
export function LoudnessLayoutMarker({ known, dense = false, className }) {
  if (known !== false) return null;
  return (
    <HoverTip
      tip={UNKNOWN_LAYOUT_TIP}
      className={cn("inline-flex shrink-0", className)}
      tipClassName="whitespace-normal w-max max-w-[15rem]"
    >
      <span
        data-testid="loudness-layout-marker"
        role="img"
        aria-label="layout not recognized, loudness uses channels 1 and 2 only"
        className={cn(
          "rounded-xs leading-none text-[color:var(--ui-content-on-warning)]",
          WARN_CHIP_BG,
          WARN_CHIP_BORDER,
          dense
            ? "px-0.5 font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-caption)] font-medium"
            : "px-1 font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-caption)]"
        )}
      >
        Ch 1–2
      </span>
    </HoverTip>
  );
}
