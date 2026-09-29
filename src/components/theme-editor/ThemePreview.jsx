import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { compileTheme } from "../../theme/compileTheme.js";
import { analyzeThemeVisuals } from "../../theme/themeVisualAnalysis.js";
import { Button } from "../ui/button.jsx";
import { SCRIM_CLASS } from "../ui/surfaceStyles.js";
import { ThemeVisualReview } from "./ThemeWarningSummary.jsx";

function PreviewCard({ title, children }) {
  return (
    <section className="min-h-24 rounded-md border border-border bg-card p-3 text-card-foreground">
      <div className="mb-2 text-[length:var(--ui-fs-metric-meta)] font-semibold">{title}</div>
      {children}
    </section>
  );
}

function OverviewScene() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <PreviewCard title="Surfaces">
        <div className="grid grid-cols-3 gap-1 text-[length:var(--ui-fs-axis)]">
          <div className="rounded-xs bg-card p-2">Panel</div>
          <div className="rounded-xs bg-popover p-2">Raised</div>
          <div className="rounded-xs bg-secondary p-2">Control</div>
          <div className="rounded-xs bg-muted p-2 text-muted-foreground">Muted</div>
          <div className="rounded-xs bg-accent p-2 text-accent-foreground">Selected</div>
        </div>
      </PreviewCard>
      <PreviewCard title="Text & Content">
        <p className="text-foreground">Primary value −14.2 LUFS</p>
        <p className="text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
          Secondary description and metadata
        </p>
        <div className="mt-2 flex flex-wrap gap-1 text-[length:var(--ui-fs-axis)]">
          <span className="rounded-xs bg-primary px-2 py-1 text-primary-foreground">Accent</span>
          <span className="rounded-xs bg-[color:var(--ui-interface-success)] px-2 py-1 text-[color:var(--ui-content-on-success)]">
            Success
          </span>
          <span className="rounded-xs bg-[color:var(--ui-interface-warning)] px-2 py-1 text-[color:var(--ui-content-on-warning)]">
            Warning
          </span>
          <span className="rounded-xs bg-destructive px-2 py-1 text-destructive-foreground">
            Danger
          </span>
        </div>
      </PreviewCard>
      <PreviewCard title="Feedback & Activity">
        <div className="flex flex-col gap-1 text-[length:var(--ui-fs-metric-meta)]">
          <span className="text-[color:var(--ui-feedback-success)]">Export complete</span>
          <span className="text-[color:var(--ui-feedback-warning)]">History truncated</span>
          <span className="text-[color:var(--ui-feedback-danger)]">Audio unavailable</span>
          <div className="mt-1 flex gap-2">
            <span className="text-[color:var(--ui-activity-live)]">● LIVE</span>
            <span className="text-[color:var(--ui-activity-snapshot)]">● SNAP</span>
          </div>
        </div>
      </PreviewCard>
      <PreviewCard title="Measurement Status">
        <div className="flex h-12 items-end gap-3">
          <span className="h-6 w-4 rounded-xs bg-[color:var(--ui-level-safe)]" />
          <span className="h-9 w-4 rounded-xs bg-[color:var(--ui-level-warning)]" />
          <span className="h-12 w-4 rounded-xs bg-[color:var(--ui-level-critical)]" />
          <div className="ml-2 flex flex-col text-[length:var(--ui-fs-axis)]">
            <span className="text-[color:var(--ui-stats-warning-value)]">−16.9 LUFS</span>
            <span className="text-[color:var(--ui-stats-critical-value)]">−0.2 dBTP</span>
          </div>
        </div>
      </PreviewCard>
    </div>
  );
}

function PreviewGrid({ color }) {
  return (
    <g stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke">
      <path d="M40 0V48M80 0V48M120 0V48" />
      <path d="M0 16H160M0 32H160" />
    </g>
  );
}

function Trace({ color, secondColor, gridColor }) {
  return (
    <svg
      viewBox="0 0 160 48"
      className="h-12 w-full"
      aria-hidden="true"
      data-theme-preview-grid={gridColor ? "" : undefined}
    >
      {gridColor ? <PreviewGrid color={gridColor} /> : null}
      <path
        d="M0 36 C25 35 28 8 48 22 S78 40 92 15 120 34 160 12"
        fill="none"
        stroke={color}
        strokeWidth="2"
      />
      {secondColor ? (
        <path
          d="M0 40 C30 32 40 18 62 30 S100 12 160 26"
          fill="none"
          stroke={secondColor}
          strokeWidth="2"
        />
      ) : null}
    </svg>
  );
}

function ModulesScene({ intensityGradient, gridColors }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <PreviewCard title="Level Meter">
        <div className="meter-gradient h-14 w-8 rounded-xs" />
      </PreviewCard>
      <PreviewCard title="Loudness">
        <Trace
          color="var(--ui-loudness-momentary)"
          secondColor="var(--ui-loudness-shortterm)"
          gridColor="var(--ui-loudness-grid)"
        />
      </PreviewCard>
      <PreviewCard title="Stats">
        <div className="grid grid-cols-2 text-[length:var(--ui-fs-axis)]">
          <span className="text-muted-foreground">Integrated</span>
          <span className="text-right text-[color:var(--ui-stats-warning-value)]">−16.9 LUFS</span>
          <span className="text-muted-foreground">TP Max</span>
          <span className="text-right text-[color:var(--ui-stats-critical-value)]">−0.2 dBTP</span>
        </div>
      </PreviewCard>
      <PreviewCard title="Vectorscope">
        <div
          data-theme-preview-guides=""
          className="relative mx-auto size-14 rounded-full border border-[color:var(--ui-vectorscope-guides-stroke)]"
        >
          <span className="absolute top-1/2 left-1/2 size-3 -translate-1/2 rounded-full bg-[color:var(--ui-vectorscope-trace)]" />
          <span className="absolute right-0 bottom-0 size-2 rounded-full bg-[color:var(--ui-vectorscope-correlation-warning)]" />
        </div>
      </PreviewCard>
      <PreviewCard title="Spectrum">
        <Trace
          color="var(--ui-spectrum-primary)"
          secondColor="var(--ui-spectrum-secondary)"
          gridColor="var(--ui-spectrum-grid)"
        />
      </PreviewCard>
      <PreviewCard title="Spectrogram">
        <div
          className="relative h-12 overflow-hidden rounded-xs"
          style={{ background: intensityGradient }}
        >
          <svg
            data-theme-preview-grid=""
            viewBox="0 0 160 48"
            className="absolute inset-0 size-full"
            aria-hidden="true"
          >
            <PreviewGrid color={gridColors.spectrogram} />
          </svg>
        </div>
      </PreviewCard>
      <PreviewCard title="Waveform">
        <div className="flex flex-col gap-2">
          <div className="h-4 rounded-full bg-[color:var(--ui-waveform-trace)]" />
          <div className="h-4 rounded-full bg-[color:var(--ui-waveform-trace-snap)]" />
        </div>
      </PreviewCard>
      <PreviewCard title="Stereo Map">
        <div className="relative flex h-12 items-end justify-center gap-4 overflow-hidden">
          <svg
            data-theme-preview-grid=""
            viewBox="0 0 160 48"
            className="absolute inset-0 size-full"
            aria-hidden="true"
          >
            <PreviewGrid color={gridColors.stereoMap} />
          </svg>
          <span className="h-9 w-5 bg-[color:var(--ui-stereo-map-primary)]" />
          <span className="h-5 w-5 bg-[color:var(--ui-stereo-map-secondary)]" />
        </div>
      </PreviewCard>
    </div>
  );
}

export function ThemePreview({ draft, onClose, onJump }) {
  const [page, setPage] = useState("overview");
  const resolved = useMemo(() => compileTheme(draft), [draft]);
  const visualWarnings = useMemo(() => analyzeThemeVisuals(draft).warnings, [draft]);
  const style = useMemo(() => Object.fromEntries(Object.entries(resolved.css)), [resolved]);
  const intensityGradient = `linear-gradient(to right, ${resolved.roles["palette.intensity.stops"]
    .map((stop) => `${stop.color} ${stop.position * 100}%`)
    .join(", ")})`;
  const gridColors = {
    spectrogram: resolved.roles["spectrogram.grid"],
    stereoMap: resolved.roles["stereoMap.grid"],
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={`${SCRIM_CLASS} z-[70]`} />
        <Dialog.Content
          aria-label="Theme preview"
          className="fixed top-1/2 left-1/2 z-[71] flex max-h-[90vh] w-[calc(100%-3rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-modal"
          style={style}
        >
          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="font-semibold">Theme Preview</Dialog.Title>
              <Dialog.Description className="text-[length:var(--ui-fs-axis)] text-muted-foreground">
                Controlled scenes from the current unsaved Draft
              </Dialog.Description>
            </div>
            <Button variant="ghost" size="icon" aria-label="Close theme preview" onClick={onClose}>
              <X />
            </Button>
          </header>
          <div
            role="tablist"
            aria-label="Theme preview scenes"
            className="flex border-b border-border px-3"
          >
            {[
              ["overview", "Overview"],
              ["modules", "Modules"],
              ["review", "Visual Review"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={page === id}
                onClick={() => setPage(id)}
                className={`border-b-2 px-3 py-2 text-[length:var(--ui-fs-metric-meta)] ${page === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="overflow-y-auto p-4">
            {page === "overview" ? (
              <OverviewScene />
            ) : page === "modules" ? (
              <ModulesScene intensityGradient={intensityGradient} gridColors={gridColors} />
            ) : (
              <ThemeVisualReview warnings={visualWarnings} onJump={onJump} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
