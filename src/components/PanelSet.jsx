import { RESIZE_COL_CLASS, RESIZE_ROW_CLASS } from "@/lib/shellLayout";
import { PeakPanel } from "./panels/PeakPanel";
import { LoudnessPanel } from "./panels/LoudnessPanel";
import { LoudnessStatsPanel } from "./panels/LoudnessStatsPanel";
import { SpectrumPanel } from "./panels/SpectrumPanel";
import { SpectrogramPanel } from "./panels/SpectrogramPanel";
import { VectorscopePanel } from "./panels/VectorscopePanel";

/**
 * Transitional layout: audio data consumed from AudioDataContext by each panel.
 * Only layout geometry is passed as props. Replaced by DockLayout in #95.
 */
export function PanelSet({
  mainLeft,
  leftTopRatio,
  rightTopRatio,
  spectrogramTopRatio,
  beginLayoutDrag,
  onLayoutDragMove,
  onLayoutDragUp,
}) {
  return (
    <main className="min-h-0 flex-1 gap-[var(--ui-panel-gap)] overflow-y-auto lg:flex lg:flex-col lg:gap-0 lg:overflow-hidden lg:min-h-0">
      <div
        className="lg:grid lg:min-h-0 lg:gap-0 lg:grid-cols-[var(--left)_var(--ui-panel-gap)_1fr] lg:grid-rows-[minmax(0,1fr)]"
        style={{ "--left": `${mainLeft}px`, height: `${Math.round(spectrogramTopRatio * 100)}%` }}
      >
        <section
          className="grid min-h-0 gap-[var(--ui-panel-gap)] lg:h-full lg:min-h-0 lg:gap-0 lg:grid-rows-[var(--leftTop)_var(--ui-panel-gap)_minmax(0,1fr)]"
          style={{ "--leftTop": `${Math.round(leftTopRatio * 100)}%` }}
        >
          <PeakPanel />

          <div
            className={RESIZE_ROW_CLASS}
            onPointerDown={(e) => beginLayoutDrag("left", e)}
            onPointerMove={onLayoutDragMove}
            onPointerUp={onLayoutDragUp}
            onPointerCancel={onLayoutDragUp}
          />

          <VectorscopePanel />
        </section>

        <div
          className={RESIZE_COL_CLASS}
          onPointerDown={(e) => beginLayoutDrag("main", e)}
          onPointerMove={onLayoutDragMove}
          onPointerUp={onLayoutDragUp}
          onPointerCancel={onLayoutDragUp}
        />

        <section
          className="grid min-h-0 gap-[var(--ui-panel-gap)] lg:h-full lg:min-h-0 lg:gap-0 lg:grid-rows-[var(--rightTop)_var(--ui-panel-gap)_minmax(0,1fr)]"
          style={{ "--rightTop": `${Math.round(rightTopRatio * 100)}%` }}
        >
          {/* Loudness chart + Stats stacked; replaced by independent Dock slots in #95 */}
          <div className="flex min-h-0 flex-col gap-[var(--ui-panel-gap)] lg:gap-[var(--ui-panel-gap)]">
            <LoudnessPanel />
            <LoudnessStatsPanel />
          </div>

          <div
            className={RESIZE_ROW_CLASS}
            onPointerDown={(e) => beginLayoutDrag("right", e)}
            onPointerMove={onLayoutDragMove}
            onPointerUp={onLayoutDragUp}
            onPointerCancel={onLayoutDragUp}
          />

          <SpectrumPanel />
        </section>
      </div>

      <div
        className={RESIZE_ROW_CLASS}
        onPointerDown={(e) => beginLayoutDrag("spectrogram", e)}
        onPointerMove={onLayoutDragMove}
        onPointerUp={onLayoutDragUp}
        onPointerCancel={onLayoutDragUp}
      />

      <SpectrogramPanel />
    </main>
  );
}
