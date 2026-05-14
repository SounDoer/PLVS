import { HISTORY_TIME_TICK_STEPS } from "../math/historyMath";
import { RESIZE_COL_CLASS, RESIZE_ROW_CLASS } from "@/lib/shellLayout";
import { PeakPanel } from "./panels/PeakPanel";
import { LoudnessPanel } from "./panels/LoudnessPanel";
import { SpectrumPanel } from "./panels/SpectrumPanel";
import { SpectrogramPanel } from "./panels/SpectrogramPanel";
import { VectorscopePanel } from "./panels/VectorscopePanel";

/**
 * Self-contained panel layout for the main metering view.
 * Pure display: all state lives in the parent (App / MeteringShell).
 */
export function PanelSet({
  // Layout geometry
  mainLeft,
  leftTopRatio,
  rightTopRatio,
  spectrogramTopRatio,
  beginLayoutDrag,
  onLayoutDragMove,
  onLayoutDragUp,

  // Shared across panels
  selectedOffset,
  setSelectedOffset,
  channelCount,
  peakLabelContext,

  // Peak panel
  displayAudio,
  getSamplePeakLineColor,
  fmt,
  hasTpMaxValue,
  tpMaxText,

  // Vectorscope panel
  vsGridDiagInset,
  vsGridDiagFar,
  displayVectorPath,
  correlation,
  vectorscopePairX,
  vectorscopePairY,

  // Loudness panel
  loudnessHistWidthRatio,
  historyYAxisTicks,
  targetLufs,
  referenceProfile,
  hasHistoryData,
  historyChartInteractive,
  running,
  setStatus,
  holdHistoryHud,
  showHistoryHud,
  onHistoryWheel,
  onHistoryPointerDown,
  onHistoryPointerMove,
  onHistoryPointerUp,
  histCurves,
  displayHistoryPathM,
  displayHistoryPathST,
  showSelLine,
  selLineX,
  isHistoryHudVisible,
  clampedWindowSec,
  effectiveOffsetSec,
  historyHover,
  historyTimeTicks,
  primaryMetrics,
  secondaryMetrics,
  toggleCurve,
  onHistoryHoverMove,
  onHistoryHoverLeave,

  // Spectrum panel
  displaySpectrumPath,
  displaySpectrumPeakPath,
  spectrumHover,
  onSpectrumHoverMove,
  onSpectrumHoverLeave,

  // Spectrogram panel
  spectrogramSnapRef,
  effectiveOffsetSamples,
  visibleSamples,
  totalSamples,
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
          <PeakPanel
            displayAudio={displayAudio}
            peakLabelContext={peakLabelContext}
            getSamplePeakLineColor={getSamplePeakLineColor}
            fmt={fmt}
            hasTpMaxValue={hasTpMaxValue}
            tpMaxText={tpMaxText}
          />

          <div
            className={RESIZE_ROW_CLASS}
            onPointerDown={(e) => beginLayoutDrag("left", e)}
            onPointerMove={onLayoutDragMove}
            onPointerUp={onLayoutDragUp}
            onPointerCancel={onLayoutDragUp}
          />

          <VectorscopePanel
            vsGridDiagInset={vsGridDiagInset}
            vsGridDiagFar={vsGridDiagFar}
            displayVectorPath={displayVectorPath}
            selectedOffset={selectedOffset}
            correlation={correlation}
            channelCount={channelCount}
            peakLabelContext={peakLabelContext}
            pairX={vectorscopePairX}
            pairY={vectorscopePairY}
          />
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
          <LoudnessPanel
            loudnessHistWidthRatio={loudnessHistWidthRatio}
            historyYAxisTicks={historyYAxisTicks}
            targetLufs={targetLufs}
            referenceProfile={referenceProfile}
            hasHistoryData={hasHistoryData}
            historyChartInteractive={historyChartInteractive}
            running={running}
            setSelectedOffset={setSelectedOffset}
            setStatus={setStatus}
            holdHistoryHud={holdHistoryHud}
            showHistoryHud={showHistoryHud}
            onHistoryWheel={onHistoryWheel}
            onHistoryPointerDown={onHistoryPointerDown}
            onHistoryPointerMove={onHistoryPointerMove}
            onHistoryPointerUp={onHistoryPointerUp}
            histCurves={histCurves}
            displayHistoryPathM={displayHistoryPathM}
            displayHistoryPathST={displayHistoryPathST}
            selectedOffset={selectedOffset}
            showSelLine={showSelLine}
            selLineX={selLineX}
            isHistoryHudVisible={isHistoryHudVisible}
            clampedWindowSec={clampedWindowSec}
            effectiveOffsetSec={effectiveOffsetSec}
            historyHover={historyHover}
            historyTimeTicks={historyTimeTicks}
            historyTickSteps={HISTORY_TIME_TICK_STEPS}
            primaryMetrics={primaryMetrics}
            secondaryMetrics={secondaryMetrics}
            toggleCurve={toggleCurve}
            onHistoryHoverMove={onHistoryHoverMove}
            onHistoryHoverLeave={onHistoryHoverLeave}
          />

          <div
            className={RESIZE_ROW_CLASS}
            onPointerDown={(e) => beginLayoutDrag("right", e)}
            onPointerMove={onLayoutDragMove}
            onPointerUp={onLayoutDragUp}
            onPointerCancel={onLayoutDragUp}
          />

          <SpectrumPanel
            displaySpectrumPath={displaySpectrumPath}
            displaySpectrumPeakPath={displaySpectrumPeakPath}
            channelCount={channelCount}
            selectedOffset={selectedOffset}
            spectrumHover={spectrumHover}
            onSpectrumHoverMove={onSpectrumHoverMove}
            onSpectrumHoverLeave={onSpectrumHoverLeave}
          />
        </section>
      </div>

      <div
        className={RESIZE_ROW_CLASS}
        onPointerDown={(e) => beginLayoutDrag("spectrogram", e)}
        onPointerMove={onLayoutDragMove}
        onPointerUp={onLayoutDragUp}
        onPointerCancel={onLayoutDragUp}
      />

      <SpectrogramPanel
        snapRef={spectrogramSnapRef}
        effectiveOffsetSamples={effectiveOffsetSamples}
        visibleSamples={visibleSamples}
        selectedOffset={selectedOffset}
        setSelectedOffset={setSelectedOffset}
        totalSamples={totalSamples}
      />
    </main>
  );
}
