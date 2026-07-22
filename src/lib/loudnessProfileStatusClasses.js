/// Value colour per Loudness Profile status.
///
/// Shared by every surface that reports status, so the same metric under the same profile cannot
/// read as a breach in one panel and neutral in another. Colour is the whole status surface: no
/// summary chrome, no size or weight change.
///
/// In-range watched values sit at `foreground` rather than a "good" green -- a profile that
/// shouts when nothing is wrong trains you to ignore it.
const STATUS_VALUE_CLASS = {
  ok: "text-foreground",
  warn: "text-[color:var(--ui-signal-warn)]",
  pending: "text-[color:var(--ui-signal-warn)]",
  inconclusive: "text-[color:var(--ui-signal-warn)]",
  fail: "text-[color:var(--ui-signal-bad)]",
};

/// Unwatched, n/a and Off all fall through to the default: nothing is being judged.
export function loudnessStatusValueClass(status) {
  return STATUS_VALUE_CLASS[status] ?? "text-foreground";
}
