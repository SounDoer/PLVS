import { Link2, Link2Off } from "lucide-react";

import { cn } from "@/lib/utils";
import { edgesFromViewport, viewportFromEdges } from "@/math/timeViewportEdges.js";
import { useHistoryData } from "@/workspace/AudioDataContext.jsx";
import { useAxisViewport, useAxisViewportLink } from "@/workspace/axisViewportHooks.js";
import { AXIS_VIEWPORTS, axisKindForRangeRow } from "@/workspace/axisViewports.js";
import { HIST_SAMPLE_SEC } from "@/hooks/useLoudnessHistory.js";
import { HoverTip } from "@/components/HoverTip.jsx";
import { IconAction } from "@/components/ui/icon-action";

import { SettingsRangeInput, SettingsRow } from "./SettingsWidgets.jsx";

// The panels with a time axis all edit one shared window today, so this row reads and writes the
// history context directly rather than taking props: whichever panel it is opened from, it is the
// same viewport. Phase 3 of the linked-axis work gives each panel its own, and this is where that
// choice will be revisited.
//
// The two inputs are the values at the ends of the rail, not the window and offset stored
// underneath -- see timeViewportEdges. Rendering nothing without a history context keeps Dock, which
// composes its own settings from the exported rows, and bare test renders unaffected.
/**
 * Rides the `action` slot of the range row it governs, rather than taking a row of its own: the
 * spectrogram carries one of these per axis, in a panel that already has nine rows.
 *
 * Like SettingsResetButton it must hold its width in both states -- the label column is
 * `max-content`, so a control that changed size here would shift the input beside it.
 */
export function AxisLinkToggle({ kindId, label, tipLabel }) {
  const viewport = useAxisViewportLink(kindId);
  if (!viewport.linkable) return null;

  const Icon = viewport.linked ? Link2 : Link2Off;
  const tip = `${viewport.linked ? "Unlink" : "Link"} ${tipLabel}`;
  return (
    <HoverTip tip={tip} side="top">
      <IconAction
        aria-label={label}
        aria-pressed={viewport.linked}
        onClick={() => viewport.setLinked(!viewport.linked)}
        className={cn(
          "flex shrink-0 items-center justify-center outline-none",
          viewport.linked && "text-foreground"
        )}
      >
        <Icon className="size-[length:var(--ui-icon-panel-action)]" />
      </IconAction>
    </HoverTip>
  );
}

/** The toggle for whichever axis kind a range row edits, or nothing if the row edits none. */
export function RangeRowLinkToggle({ moduleId, minKey, label }) {
  const kindId = axisKindForRangeRow(moduleId, minKey);
  if (!kindId) return null;
  return <AxisLinkToggle kindId={kindId} label={`link ${label.toLowerCase()}`} tipLabel={label} />;
}

export function AxisViewportRangeInput({
  moduleId,
  minKey,
  minAriaLabel,
  maxAriaLabel,
  controls,
  onLocalCommit,
}) {
  const kindId = axisKindForRangeRow(moduleId, minKey);
  const localKeys = AXIS_VIEWPORTS[kindId].members[moduleId];
  const viewport = useAxisViewport(kindId, localKeys);

  return (
    <SettingsRangeInput
      minAriaLabel={minAriaLabel}
      maxAriaLabel={maxAriaLabel}
      minValue={viewport.linkable ? viewport.min : controls[localKeys.minKey]}
      maxValue={viewport.linkable ? viewport.max : controls[localKeys.maxKey]}
      onCommit={viewport.linkable ? viewport.setRange : onLocalCommit}
    />
  );
}

export function TimeRangeRow() {
  const historyData = useHistoryData();
  if (typeof historyData?.setHistoryWindowSec !== "function") return null;

  const {
    sourceMode,
    totalSamples,
    visibleSamples,
    effectiveOffsetSamples,
    historyMaxWindowSec,
    setHistoryWindowSec,
    setHistoryOffsetSec,
  } = historyData;
  const viewport = {
    sourceMode,
    totalSamples,
    visibleSamples,
    effectiveOffsetSamples,
    sampleSec: HIST_SAMPLE_SEC,
  };
  const { left, right } = edgesFromViewport(viewport);

  return (
    <SettingsRow
      label="Time Range"
      controlAction={<AxisLinkToggle kindId="time" label="link time range" tipLabel="Time Range" />}
    >
      <SettingsRangeInput
        minAriaLabel="time range min"
        maxAriaLabel="time range max"
        minValue={left}
        maxValue={right}
        onCommit={(nextLeft, nextRight) => {
          const next = viewportFromEdges({
            left: nextLeft,
            right: nextRight,
            ...viewport,
            maxWindowSec: historyMaxWindowSec,
          });
          setHistoryWindowSec(next.windowSec);
          setHistoryOffsetSec(next.offsetSec);
        }}
      />
    </SettingsRow>
  );
}
