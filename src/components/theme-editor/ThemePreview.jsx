import {
  SPECTRUM_FILL_TOP,
  SPECTRUM_FILL_BOTTOM,
  STEREO_MAP_FILL_OPACITY,
  WAVEFORM_FILL_OPACITY,
} from "@/lib/chartFill.js";
import { useId, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { compileTheme } from "../../theme/compileTheme.js";
import { analyzeThemeVisuals } from "../../theme/themeVisualAnalysis.js";
import { Button } from "../ui/button.jsx";
import { Dialog, DialogContent } from "../ui/dialog.jsx";
import { LAYER_PRIORITY } from "../ui/layers.js";
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
      <PreviewCard title="Feedback & Transport">
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
      <PreviewCard title="Controls">
        <div className="flex flex-wrap gap-2">
          <Button size="sm">Primary</Button>
          <Button size="sm" variant="secondary">
            Secondary
          </Button>
          <Button size="sm" variant="destructive">
            Delete
          </Button>
          <Button size="sm" disabled>
            Disabled
          </Button>
          <Button size="sm" variant="ghost" className="bg-ui-hover text-foreground">
            Selected
          </Button>
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

function Trace({ color, secondColor, gridColor, fillTop = 0, fillBottom = fillTop }) {
  const id = useId();
  const traces = [
    [secondColor, "M0 40 C30 32 40 18 62 30 S100 12 160 26"],
    [color, "M0 36 C25 35 28 8 48 22 S78 40 92 15 120 34 160 12"],
  ].filter(([ink]) => ink);
  return (
    <svg
      viewBox="0 0 160 48"
      className="h-12 w-full"
      aria-hidden="true"
      data-theme-preview-grid={gridColor ? "" : undefined}
    >
      {gridColor ? <PreviewGrid color={gridColor} /> : null}
      {traces.map(([ink, path], index) => (
        <g key={index}>
          <defs>
            <linearGradient id={`${id}-${index}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ink} stopOpacity={fillTop} />
              <stop offset="100%" stopColor={ink} stopOpacity={fillBottom} />
            </linearGradient>
          </defs>
          <path d={`${path} L160 48H0Z`} fill={`url(#${id}-${index})`} />
          <path d={path} fill="none" stroke={ink} strokeWidth="2" />
        </g>
      ))}
    </svg>
  );
}

function ModulesScene({ intensityGradient, gridColors, resolved }) {
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
          fillTop={SPECTRUM_FILL_TOP}
          fillBottom={SPECTRUM_FILL_BOTTOM}
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
        <svg viewBox="0 0 160 48" className="h-12 w-full" aria-hidden="true">
          {["waveform.trace", "waveform.snapshot"].map((role, index) => (
            <g key={role} transform={`translate(0 ${index * 24})`}>
              <path
                d="M0 12L20 9L40 2L60 7L80 4L100 8L120 1L140 7L160 12L140 17L120 23L100 16L80 20L60 17L40 22L20 15Z"
                fill={resolved.roles[role]}
                fillOpacity={WAVEFORM_FILL_OPACITY}
                stroke={resolved.roles[role]}
                strokeWidth="1"
              />
            </g>
          ))}
        </svg>
      </PreviewCard>
      <PreviewCard title="Stereo Map">
        <Trace
          color={resolved.roles["stereoMap.primary"]}
          secondColor={resolved.roles["stereoMap.secondary"]}
          gridColor={gridColors.stereoMap}
          fillTop={STEREO_MAP_FILL_OPACITY}
        />
      </PreviewCard>
    </div>
  );
}

export function ThemePreview({ draft, onClose, onJump }) {
  const [page, setPage] = useState("overview");
  const resolved = useMemo(() => compileTheme(draft), [draft]);
  const visualWarnings = useMemo(() => analyzeThemeVisuals(draft).warnings, [draft]);
  const style = useMemo(() => ({ ...resolved.css, colorScheme: resolved.colorScheme }), [resolved]);
  const intensityGradient = `linear-gradient(to right, ${resolved.roles["palette.intensity.stops"]
    .map((stop) => `${stop.color} ${stop.position * 100}%`)
    .join(", ")})`;
  const gridColors = {
    spectrogram: resolved.roles["spectrogram.grid"],
    stereoMap: resolved.roles["stereoMap.grid"],
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-label="Theme preview"
        size="custom"
        layer={LAYER_PRIORITY}
        className="theme-preview max-h-[90vh] w-[calc(100%-3rem)] max-w-3xl bg-background p-0 text-foreground"
        style={style}
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="font-semibold">Theme Preview</DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-[length:var(--ui-fs-axis)] text-muted-foreground">
              Controlled scenes from the current unsaved Draft
            </DialogPrimitive.Description>
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
            <ModulesScene
              intensityGradient={intensityGradient}
              gridColors={gridColors}
              resolved={resolved}
            />
          ) : (
            <ThemeVisualReview warnings={visualWarnings} onJump={onJump} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
