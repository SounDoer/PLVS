/// Colour per Loudness Profile status, split by what each surface colours.
///
/// Shared so the same metric under the same profile cannot read as a breach on one surface and
/// neutral on another. The surfaces disagree on *where* the "watched" signal lives, so they need
/// different maps -- but they agree on the warn/fail colours, which is what matters for status.

/// The statuses the profile is actively judging (as opposed to unwatched / n/a / off).
const JUDGED_STATUS = new Set(["ok", "warn", "pending", "inconclusive", "fail"]);

const VALUE_CLASS = {
  ok: "text-foreground",
  warn: "text-[color:var(--ui-signal-warn)]",
  pending: "text-[color:var(--ui-signal-warn)]",
  inconclusive: "text-[color:var(--ui-signal-warn)]",
  fail: "text-[color:var(--ui-signal-bad)]",
};

/// Stats / Dock value colour. The value never dims: unwatched, n/a and off all stay at
/// `foreground`, so a number only leaves white when it is actually warning or failing. Which
/// metrics the profile watches is carried by the label instead (see `loudnessStatusLabelClass`),
/// which keeps every readout equally legible.
export function loudnessStatusValueClass(status) {
  return VALUE_CLASS[status] ?? "text-foreground";
}

/// Stats / Dock label colour. The label brightens to `foreground` for the metrics the profile is
/// judging and stays muted otherwise -- this is the whole "watched vs unwatched" signal. Off
/// yields undefined statuses, so every label stays muted, which is the no-profile look.
export function loudnessStatusLabelClass(status) {
  return JUDGED_STATUS.has(status) ? "text-foreground" : "text-muted-foreground";
}

const MARKER_CLASS = {
  ok: "text-foreground",
  warn: "text-[color:var(--ui-signal-warn)]",
  pending: "text-[color:var(--ui-signal-warn)]",
  inconclusive: "text-[color:var(--ui-signal-warn)]",
  fail: "text-[color:var(--ui-signal-bad)]",
};

/// Level-meter readout marker colour. A meter marker has no separate label to carry the watched
/// signal, so it carries it itself: with no profile the marker keeps its accent readout colour
/// (returns undefined, so the caller's `text-primary` shows through); under a profile it follows
/// the status, and an unwatched / n/a metric dims to muted so it reads as "not part of this
/// profile".
export function loudnessMeterMarkerClass(status, profileActive) {
  if (!profileActive) return undefined;
  return MARKER_CLASS[status] ?? "text-muted-foreground";
}
