import { HoverTip } from "@/components/HoverTip";
import { cn } from "@/lib/utils";

export const UNKNOWN_LAYOUT_TIP = "Layout not recognized. Loudness uses channels 1–2 only.";

/**
 * Shown wherever loudness is read out while the engine measured Ch1/Ch2 of an unrecognized
 * channel layout. `known` is `loudnessLayoutKnown`; only an explicit `false` shows the marker.
 */
export function LoudnessLayoutMarker({ known, className }) {
  if (known !== false) return null;
  return (
    <HoverTip
      tip={UNKNOWN_LAYOUT_TIP}
      className={cn("inline-flex shrink-0", className)}
      tipClassName="whitespace-normal w-max max-w-[15rem]"
    >
      <span
        data-testid="loudness-layout-marker"
        aria-label="loudness uses channels 1 and 2 only"
        className="rounded-xs border border-[color:var(--ui-signal-warn)] px-1 font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-caption)] leading-none text-[color:var(--ui-signal-warn)]"
      >
        Ch 1–2
      </span>
    </HoverTip>
  );
}
