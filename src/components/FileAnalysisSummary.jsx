import { formatClock } from "../hooks/useSessionTimer.js";

function fmtNumber(value, suffix) {
  return Number.isFinite(value) ? `${value.toFixed(1)} ${suffix}` : `-- ${suffix}`;
}

function trackLine(track) {
  if (!track) return "No track metadata";
  const sampleRate = Number.isFinite(track.sampleRateHz)
    ? `${Math.round(track.sampleRateHz / 1000)} kHz`
    : "unknown rate";
  const channels = Number.isFinite(track.channels) ? `${track.channels} ch` : "unknown channels";
  return `Track ${track.index ?? 0} · ${track.codec || "unknown codec"} · ${sampleRate} · ${channels}`;
}

// Metrics come from the authoritative completion summary payload (fileSession.summary), not the
// last displayed UI frame, so throttled/batched frames cannot skew the delivery numbers.
export function FileAnalysisSummary({ fileSession }) {
  if (fileSession?.state === "error") {
    return (
      <section className="min-w-72 rounded-md border border-border bg-popover p-3 text-sm text-popover-foreground">
        <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ui-signal-bad)]">
          File analysis error
        </p>
        <p className="mt-1 text-sm">{fileSession.error}</p>
      </section>
    );
  }

  const metadata = fileSession?.metadata;
  const summary = fileSession?.summary ?? {};
  const fileName = fileSession?.fileName || "No file";
  const track = metadata?.selectedTrack;
  const samplePeakMax = Math.max(
    summary.samplePeakMaxLDb ?? -Infinity,
    summary.samplePeakMaxRDb ?? -Infinity
  );

  return (
    <section className="min-w-72 rounded-md border border-border bg-popover p-3 text-sm text-popover-foreground">
      <p className="truncate text-sm font-semibold text-foreground">{fileName}</p>
      <p className="mt-1 text-xs text-muted-foreground">{trackLine(track)}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Integrated</dt>
          <dd className="font-semibold tabular-nums text-foreground">
            {fmtNumber(summary.integratedLufs, "LUFS")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">LRA</dt>
          <dd className="font-semibold tabular-nums text-foreground">
            {fmtNumber(summary.lra, "LU")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">True Peak Max</dt>
          <dd className="font-semibold tabular-nums text-foreground">
            {fmtNumber(summary.truePeakMaxDbtp, "dBTP")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Sample Peak Max</dt>
          <dd className="font-semibold tabular-nums text-foreground">
            {fmtNumber(samplePeakMax, "dBFS")}
          </dd>
        </div>
      </dl>
      {fileSession?.historyTruncated ? (
        <p className="mt-3 text-xs text-[color:var(--ui-signal-warn)]">
          Delivery metrics cover the whole file. Scrub history is limited to the last{" "}
          {formatClock(fileSession.historyCoveredMs ?? 0)}.
        </p>
      ) : null}
    </section>
  );
}
