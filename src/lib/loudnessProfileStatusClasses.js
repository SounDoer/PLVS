/// Colour per Loudness Profile status, split by what each surface colours.
///
/// Shared so the same metric under the same profile cannot read as a breach on one surface and
/// neutral on another. The surfaces disagree on *where* the "watched" signal lives, so they need
/// different maps -- but they agree on the warn/fail colours, which is what matters for status.

const VALUE_CLASS = {
  ok: "text-foreground",
  warn: "text-[color:var(--ui-signal-warn)]",
  pending: "text-[color:var(--ui-signal-warn)]",
  inconclusive: "text-[color:var(--ui-signal-warn)]",
  fail: "text-[color:var(--ui-signal-bad)]",
};

/// Stats / Dock value colour. The value never dims: unwatched and off both stay at `foreground`,
/// so a number only leaves white when it is actually warning or failing. Which metrics the profile
/// watches is carried by the label instead (see `loudnessLabelClass`), which keeps every readout
/// equally legible.
export function loudnessStatusValueClass(status) {
  return VALUE_CLASS[status] ?? "text-foreground";
}

/// Stats / Dock label colour. The label brightens to `foreground` for the metrics the profile
/// watches -- a metric counts as watched the moment it has a rule, filled in or not -- and stays
/// muted otherwise. With no profile nothing is watched, so every label stays muted.
export function loudnessLabelClass(watched) {
  return watched ? "text-foreground" : "text-muted-foreground";
}

const MARKER_CLASS = {
  ok: "text-foreground",
  warn: "text-[color:var(--ui-signal-warn)]",
  pending: "text-[color:var(--ui-signal-warn)]",
  inconclusive: "text-[color:var(--ui-signal-warn)]",
  fail: "text-[color:var(--ui-signal-bad)]",
};

/// Level-meter readout marker colour. With no profile the marker keeps its accent readout colour
/// (returns undefined, so the caller's `text-primary` shows through); under a profile it follows
/// the status, and anything not warning or failing -- including an unwatched metric -- stays white,
/// so only an actual breach pulls the eye.
export function loudnessMeterMarkerClass(status, profileActive) {
  if (!profileActive) return undefined;
  return MARKER_CLASS[status] ?? "text-foreground";
}
