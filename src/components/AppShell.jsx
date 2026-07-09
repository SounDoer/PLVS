import { MeterRuntimeEngines } from "../runtime/MeterRuntimeEngines.jsx";
import { AppHeader } from "./AppHeader.jsx";
import { FileAnalysisSummary } from "./FileAnalysisSummary.jsx";
import { FileDropOverlay } from "./FileDropOverlay.jsx";
import { SplitLayout } from "../workspace/SplitLayout.jsx";
import { PanelDataProviders } from "../workspace/PanelDataProviders.jsx";
import {
  FOOTER_DIVIDER,
  FOOTER_LABEL,
  FOOTER_VALUE,
  SHELL_BOTTOM_REVEAL_HOT_ZONE,
  SHELL_FOOTER,
  SHELL_FOOTER_OVERLAY,
  SHELL_INNER,
  SHELL_INNER_FOCUS,
  SHELL_PAGE,
  SHELL_TOP_REVEAL_HOT_ZONE,
} from "@/lib/shellLayout";

export function AppShell({
  sharedPanelData,
  runtimeEnginesProps,
  fileDropProps,
  focusView,
  focusControlsVisible,
  shellHandlers,
  headerProps,
  showFileAnalysisResult,
  fileSummaryProps,
  panelChromeData,
  footer,
  children,
}) {
  const autoHideControls = focusView.autoHideControls;
  const controlsVisible = !autoHideControls || focusControlsVisible;

  return (
    <PanelDataProviders sharedPanelData={sharedPanelData} panelChromeData={panelChromeData}>
      <MeterRuntimeEngines {...runtimeEnginesProps} />
      <FileDropOverlay {...fileDropProps} />
      <div className={SHELL_PAGE}>
        <div
          className={autoHideControls ? SHELL_INNER_FOCUS : SHELL_INNER}
          onPointerLeave={autoHideControls ? shellHandlers.hideFocusControlsNow : undefined}
        >
          {autoHideControls ? (
            <div
              className={SHELL_TOP_REVEAL_HOT_ZONE}
              onPointerEnter={shellHandlers.showFocusControls}
              onPointerDown={shellHandlers.handleWindowDrag}
              onPointerUp={shellHandlers.releaseFocusControlsHold}
              onPointerCancel={shellHandlers.releaseFocusControlsHold}
            />
          ) : null}
          {controlsVisible ? <AppHeader {...headerProps} /> : null}

          {showFileAnalysisResult ? (
            <div
              className={
                autoHideControls
                  ? "absolute left-[var(--ui-shell-pad)] right-[var(--ui-shell-pad)] top-[calc(var(--ui-shell-pad)+2.75rem)] z-30"
                  : "shrink-0"
              }
              onPointerEnter={autoHideControls ? shellHandlers.showFocusControls : undefined}
              onPointerLeave={autoHideControls ? shellHandlers.hideFocusControlsLater : undefined}
            >
              <FileAnalysisSummary {...fileSummaryProps} />
            </div>
          ) : null}

          <SplitLayout />

          {controlsVisible ? (
            <footer
              className={autoHideControls ? SHELL_FOOTER_OVERLAY : SHELL_FOOTER}
              onPointerEnter={autoHideControls ? shellHandlers.showFocusControls : undefined}
              onPointerLeave={autoHideControls ? shellHandlers.hideFocusControlsLater : undefined}
            >
              <span className={FOOTER_LABEL}>Device</span>
              <span className={FOOTER_VALUE}>{footer.deviceLabel}</span>
              <div className={FOOTER_DIVIDER} />
              <span className={FOOTER_LABEL}>Ref</span>
              <span className={FOOTER_VALUE}>{footer.referenceLufs} LUFS</span>
              <div className={FOOTER_DIVIDER} />
              <span className={FOOTER_LABEL}>Preset</span>
              <span className={FOOTER_VALUE}>{footer.activePresetName}</span>
              {footer.hasUpdate ? (
                <>
                  <div className={FOOTER_DIVIDER} />
                  <button
                    type="button"
                    onClick={footer.onOpenSettings}
                    className="min-w-0 truncate text-[length:var(--ui-fs-status)] text-primary hover:underline"
                  >
                    Update available · Check in Settings
                  </button>
                </>
              ) : null}
            </footer>
          ) : null}
          {autoHideControls ? (
            <div
              className={SHELL_BOTTOM_REVEAL_HOT_ZONE}
              onPointerEnter={shellHandlers.showFocusControls}
            />
          ) : null}
        </div>

        {children}
      </div>
    </PanelDataProviders>
  );
}
