import { DeviceSelectionContent } from "./DeviceSelectionContent.jsx";
import { useState } from "react";
import {
  Bookmark,
  Focus,
  FolderOpen,
  Gauge,
  LayoutGrid,
  Settings,
  Trash2,
  Volume2,
} from "lucide-react";
import { HoverTip } from "./HoverTip.jsx";
import { IconButton } from "./IconButton.jsx";
import { SourceTransportCluster } from "./SourceTransportCluster.jsx";
import { PresetsPopoverContent } from "./PresetsPopover.jsx";
import { LoudnessProfilePopoverContent } from "./LoudnessProfilePopover.jsx";
import { FocusViewPopoverContent } from "./FocusViewPopover.jsx";
import { ModulesPopoverContent } from "../workspace/WorkspaceToolbar.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { POPOVER_HEADER_CLASS, POPOVER_TITLE_CLASS } from "@/components/ui/surfaceStyles.js";
import { SHELL_HEADER, SHELL_HEADER_ACTIONS, SHELL_HEADER_OVERLAY } from "@/lib/shellLayout";
import { cn } from "@/lib/utils";
import { AppStatusPopover } from "./AppStatus.jsx";

const TOOLBAR_POPOVER_CLASS = "w-max min-w-40 max-w-[min(18rem,92vw)] p-1";
const SOURCES_POPOVER_CLASS =
  "flex max-h-[var(--radix-popover-content-available-height)] w-max min-w-[calc(10em+2rem)] max-w-[min(calc(24em+1.5rem),92vw)] flex-col overflow-hidden p-1 text-[length:var(--ui-fs-control)]";
// Matches DockHeader's pressed-while-open treatment for its editor triggers: the trigger's `span`
// wrapper picks up Radix's `data-state` via `asChild`, so `group` + `group-data-` needs no state of
// its own and stays true to Popover's actual open/closed status.
const TOOLBAR_TRIGGER_OPEN_CLASS =
  "group-data-[state=open]:bg-ui-hover group-data-[state=open]:text-foreground";

/**
 * @param {{
 *   loudnessProfile: import("../hooks/LoudnessProfileContext.jsx").LoudnessProfileApi,
 *   loudnessProfileStats: { visibleIds: string[], onShowMissing: (...args: any[]) => any } | null,
 *   autoHideControls: boolean,
 *   onPointerEnter: (...args: any[]) => any,
 *   onPointerLeave: (...args: any[]) => any,
 *   onPointerDown: (...args: any[]) => any,
 *   onPointerUp: (...args: any[]) => any,
 *   onPointerCancel: (...args: any[]) => any,
 *   sourceTransportState: ReturnType<typeof import("../lib/sourceTransportState.js").deriveSourceTransportState>,
 *   notice: { kind?: string, text: string, details?: string } | null,
 *   statusItems?: import("../lib/appStatus.js").AppStatusItem[],
 *   statusOpen?: boolean,
 *   onStatusAction?: (action: string) => void,
 *   sourceMode: string,
 *   onSourceModeChange: (...args: any[]) => any,
 *   onSourceTransportAction: (...args: any[]) => any,
 *   onClear: (...args: any[]) => any,
 *   clearDisabled: boolean,
 *   isTauriApp: boolean,
 *   onOpenFile: (...args: any[]) => any,
 *   audioDevices: any[],
 *   audioOutputs: any[],
 *   audioInputs: any[],
 *   captureApplications?: any[],
 *   onRefreshSources: (...args: any[]) => any,
 *   safeAudioDeviceId: string,
 *   setCaptureDeviceId: (...args: any[]) => any,
 *   holdFocusControls: (...args: any[]) => any,
 *   panelPresentation?: import("../lib/panelPresentation.js").PanelPresentation,
 *   setPanelPresentation?: (value: import("../lib/panelPresentation.js").PanelPresentation) => void,
 *   focusView: import("../lib/focusView.js").FocusView,
 *   pinned: boolean,
 *   setPinned: (...args: any[]) => any,
 *   setAutoHideControls: (...args: any[]) => any,
 *   setCompactPanels: (...args: any[]) => any,
 *   setBorderless: (...args: any[]) => any,
 *   surfaceOpacity: number,
 *   setSurfaceOpacity: (...args: any[]) => any,
 *   glassEnabled: boolean,
 *   setGlassEnabled: (...args: any[]) => any,
 *   showDock: boolean,
 *   dockEdge: string,
 *   onDockChange: (...args: any[]) => any,
 *   dockDisabled: boolean,
 *   presets: import("../hooks/usePresets.js").PresetsEditor,
 *   onExportLibraryItem?: (...args: any[]) => any,
 *   setSettingsOpen: (...args: any[]) => any,
 * }} props
 */
export function AppHeader({
  loudnessProfile,
  loudnessProfileStats,
  autoHideControls,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  sourceTransportState,
  notice,
  statusItems = [],
  statusOpen = false,
  onStatusAction,
  sourceMode,
  onSourceModeChange,
  onSourceTransportAction,
  onClear,
  clearDisabled,
  isTauriApp,
  onOpenFile,
  audioDevices,
  audioOutputs,
  audioInputs,
  captureApplications = [],
  onRefreshSources,
  safeAudioDeviceId,
  setCaptureDeviceId,
  holdFocusControls,
  panelPresentation,
  setPanelPresentation,
  focusView,
  pinned,
  setPinned,
  setAutoHideControls,
  setCompactPanels,
  setBorderless,
  surfaceOpacity,
  setSurfaceOpacity,
  glassEnabled,
  setGlassEnabled,
  showDock,
  dockEdge,
  onDockChange,
  dockDisabled,
  presets,
  onExportLibraryItem = () => {},
  setSettingsOpen,
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const handleSourceSelect = (/** @type {string} */ id) => {
    setCaptureDeviceId(id);
    setSourcesOpen(false);
  };

  const handlePrimaryAction = (actionKind) => {
    onSourceTransportAction(actionKind);
  };

  return (
    <header
      className={autoHideControls ? SHELL_HEADER_OVERLAY : SHELL_HEADER}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <SourceTransportCluster
        state={sourceTransportState}
        sourceMode={sourceMode}
        onSourceModeChange={onSourceModeChange}
        onPrimaryAction={handlePrimaryAction}
      />
      <AppStatusPopover
        requestedOpen={statusOpen}
        items={statusItems}
        onAction={onStatusAction}
        onOpenChange={autoHideControls ? holdFocusControls : undefined}
      />
      {notice && statusItems.length === 0 ? (
        <HoverTip
          tip={notice.details ?? notice.text}
          align="start"
          className="min-w-0 max-w-[min(30rem,34vw)]"
          tipClassName="whitespace-normal max-w-[min(28rem,90vw)]"
        >
          <div
            className={cn(
              "truncate text-[length:var(--ui-fs-status)] font-medium",
              notice.kind === "error"
                ? "text-[color:var(--ui-feedback-danger)]"
                : "text-muted-foreground"
            )}
          >
            {notice.text}
          </div>
        </HoverTip>
      ) : null}
      <div className="flex-1" />
      <div className={SHELL_HEADER_ACTIONS}>
        <IconButton
          icon={<Trash2 className="size-[length:var(--ui-icon-shell-action)]" />}
          tip="Clear"
          data-tour-target="clear"
          disabled={clearDisabled}
          onClick={onClear}
        />
        {isTauriApp &&
          (sourceMode === "file" ? (
            // Reuse the Sources slot (meaningless in File mode) as a re-import affordance,
            // mirroring the ANALYZE picker without adding a new toolbar control.
            <IconButton
              icon={<FolderOpen className="size-[length:var(--ui-icon-shell-action)] shrink-0" />}
              tip="Open file"
              onClick={onOpenFile}
            />
          ) : (
            <Popover
              open={sourcesOpen}
              onOpenChange={(open) => {
                if (open && !audioDevices.length && !captureApplications.length) return;
                if (open) void onRefreshSources?.();
                setSourcesOpen(open);
                if (autoHideControls) holdFocusControls(open);
              }}
            >
              <PopoverTrigger asChild>
                <span className="group">
                  <IconButton
                    icon={
                      <Volume2 className="size-[length:var(--ui-icon-shell-action)] shrink-0" />
                    }
                    tip="Sources"
                    data-tour-target="sources"
                    disabled={!audioDevices.length && !captureApplications.length}
                    className={TOOLBAR_TRIGGER_OPEN_CLASS}
                  />
                </span>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className={SOURCES_POPOVER_CLASS}>
                <p className={`${POPOVER_HEADER_CLASS} ${POPOVER_TITLE_CLASS}`}>Sources</p>
                <DeviceSelectionContent
                  audioOutputs={audioOutputs}
                  audioInputs={audioInputs}
                  captureApplications={captureApplications}
                  safeAudioDeviceId={safeAudioDeviceId}
                  onSelect={handleSourceSelect}
                />
              </PopoverContent>
            </Popover>
          ))}
        <Popover onOpenChange={autoHideControls ? holdFocusControls : undefined}>
          <PopoverTrigger asChild>
            <span className="group">
              <IconButton
                icon={<Gauge className="size-[length:var(--ui-icon-shell-action)]" />}
                tip="Loudness Profile"
                data-tour-target="profile"
                className={TOOLBAR_TRIGGER_OPEN_CLASS}
              />
            </span>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className={TOOLBAR_POPOVER_CLASS}>
            <LoudnessProfilePopoverContent
              profile={loudnessProfile}
              stats={loudnessProfileStats}
              onExport={(id) => onExportLibraryItem("loudness", id)}
            />
          </PopoverContent>
        </Popover>
        <Popover onOpenChange={autoHideControls ? holdFocusControls : undefined}>
          <PopoverTrigger asChild>
            <span className="group">
              <IconButton
                icon={<LayoutGrid className="size-[length:var(--ui-icon-shell-action)]" />}
                tip="Modules"
                data-tour-target="modules"
                className={TOOLBAR_TRIGGER_OPEN_CLASS}
              />
            </span>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className={TOOLBAR_POPOVER_CLASS}>
            <ModulesPopoverContent />
          </PopoverContent>
        </Popover>
        <Popover onOpenChange={autoHideControls ? holdFocusControls : undefined}>
          <PopoverTrigger asChild>
            <span className="group">
              <IconButton
                icon={<Focus className="size-[length:var(--ui-icon-shell-action)]" />}
                tip="Views"
                data-tour-target="views"
                className={TOOLBAR_TRIGGER_OPEN_CLASS}
              />
            </span>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className={TOOLBAR_POPOVER_CLASS}>
            <FocusViewPopoverContent
              pinned={pinned}
              setPinned={setPinned}
              panelPresentation={panelPresentation}
              setPanelPresentation={setPanelPresentation}
              focusView={focusView}
              setAutoHideControls={setAutoHideControls}
              setCompactPanels={setCompactPanels}
              setBorderless={setBorderless}
              surfaceOpacity={surfaceOpacity}
              setSurfaceOpacity={setSurfaceOpacity}
              glassEnabled={glassEnabled}
              setGlassEnabled={setGlassEnabled}
              showDock={showDock}
              dockEdge={dockEdge}
              onDockChange={onDockChange}
              dockDisabled={dockDisabled}
            />
          </PopoverContent>
        </Popover>
        <Popover onOpenChange={autoHideControls ? holdFocusControls : undefined}>
          <PopoverTrigger asChild>
            <span className="group">
              <IconButton
                icon={<Bookmark className="size-[length:var(--ui-icon-shell-action)]" />}
                tip="Presets"
                data-tour-target="presets"
                className={TOOLBAR_TRIGGER_OPEN_CLASS}
              />
            </span>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            className={cn(TOOLBAR_POPOVER_CLASS, "max-w-[92vw]")}
          >
            <PresetsPopoverContent
              presets={presets}
              onExport={(id) => onExportLibraryItem("presets", id)}
            />
          </PopoverContent>
        </Popover>
        <IconButton
          icon={<Settings className="size-[length:var(--ui-icon-shell-action)]" />}
          tip="Settings"
          data-tour-target="settings"
          onClick={() => setSettingsOpen(true)}
        />
      </div>
    </header>
  );
}
