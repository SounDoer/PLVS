import { useState } from "react";
import {
  Bookmark,
  ChevronRight,
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
import { formatAudioDeviceLabel } from "@/lib/audioDeviceLabels.js";
import { cn } from "@/lib/utils";

const TOOLBAR_POPOVER_CLASS = "w-max min-w-40 max-w-[min(18rem,92vw)] p-1";
const SOURCES_POPOVER_CLASS =
  "flex max-h-[var(--radix-popover-content-available-height)] w-max min-w-[calc(10em+2rem)] max-w-[min(calc(24em+1.5rem),92vw)] flex-col overflow-hidden p-1 text-[length:var(--ui-fs-control)]";
// Matches DockHeader's pressed-while-open treatment for its editor triggers: the trigger's `span`
// wrapper picks up Radix's `data-state` via `asChild`, so `group` + `group-data-` needs no state of
// its own and stays true to Popover's actual open/closed status.
const TOOLBAR_TRIGGER_OPEN_CLASS =
  "group-data-[state=open]:bg-ui-hover group-data-[state=open]:text-foreground";

function SourceRow({ primary, secondary, selected, onSelect, ariaLabel }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-xs px-1.5 py-1.5 text-left text-[length:var(--ui-fs-control)] transition-colors hover:bg-ui-hover"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full border",
          selected ? "border-primary bg-primary" : "border-muted-foreground bg-transparent"
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground">{primary}</span>
        {secondary ? (
          <span className="mt-0.5 block truncate text-muted-foreground">{secondary}</span>
        ) : null}
      </span>
    </button>
  );
}

function AudioDeviceOption({ device, selected, onSelect }) {
  const label = formatAudioDeviceLabel(device.label);
  return (
    <SourceRow
      ariaLabel={label.full}
      primary={label.primary}
      secondary={label.secondary}
      selected={selected}
      onSelect={onSelect}
    />
  );
}

function selectedDeviceSummary(devices, selectedId) {
  const selected = devices.find((device) => device.id === selectedId);
  if (!selected) return null;
  return `${formatAudioDeviceLabel(selected.label).primary} Selected`;
}

function selectedApplicationSummary(applications, selectedId) {
  const selected = applications.find((application) => application.id === selectedId);
  return selected ? `${selected.label} Selected` : null;
}

function SourceSection({ id, label, count, open, onOpenChange, selectedSummary, children }) {
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-1.5 rounded-xs px-1.5 py-1.5 text-left text-[length:var(--ui-fs-control)] transition-colors hover:bg-ui-hover"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-[1em] shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
            {label}
            {selectedSummary ? (
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
            ) : null}
          </span>
          {selectedSummary ? (
            <span className="mt-0.5 block truncate text-[length:var(--ui-fs-caption)] text-muted-foreground">
              {selectedSummary}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-[length:var(--ui-fs-caption)] tabular-nums text-muted-foreground">
          {count}
        </span>
      </button>
      <div
        id={id}
        aria-hidden={open ? undefined : true}
        inert={!open}
        className={cn("pl-3", !open && "pointer-events-none h-0 overflow-hidden opacity-0")}
      >
        {children}
      </div>
    </section>
  );
}

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
  const [sourceSectionsOpen, setSourceSectionsOpen] = useState({
    output: false,
    input: false,
    applications: false,
  });

  const setSourceSectionOpen = (section, open) => {
    setSourceSectionsOpen((current) => ({ ...current, [section]: open }));
  };

  const selectedOutputSummary = selectedDeviceSummary(audioOutputs, safeAudioDeviceId);
  const selectedInputSummary = selectedDeviceSummary(audioInputs, safeAudioDeviceId);
  const selectedApplication = selectedApplicationSummary(captureApplications, safeAudioDeviceId);

  const handleSourceSelect = (id) => {
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
      {notice ? (
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
                    disabled={!audioDevices.length && !captureApplications.length}
                    className={TOOLBAR_TRIGGER_OPEN_CLASS}
                  />
                </span>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className={SOURCES_POPOVER_CLASS}>
                <p className={`${POPOVER_HEADER_CLASS} ${POPOVER_TITLE_CLASS}`}>Sources</p>
                <SourceRow
                  ariaLabel="Automatic"
                  primary="Automatic"
                  selected={safeAudioDeviceId === "default"}
                  onSelect={() => handleSourceSelect("default")}
                />
                <div className="mx-1 border-t border-border" />
                <div
                  data-source-scroll
                  className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
                >
                  {audioOutputs.length ? (
                    <SourceSection
                      id="source-output-list"
                      label="Output"
                      count={audioOutputs.length}
                      open={sourceSectionsOpen.output}
                      onOpenChange={(open) => setSourceSectionOpen("output", open)}
                      selectedSummary={selectedOutputSummary}
                    >
                      {audioOutputs.map((device) => (
                        <AudioDeviceOption
                          key={device.id}
                          device={device}
                          selected={safeAudioDeviceId === device.id}
                          onSelect={() => handleSourceSelect(device.id)}
                        />
                      ))}
                    </SourceSection>
                  ) : null}
                  {audioInputs.length ? (
                    <SourceSection
                      id="source-input-list"
                      label="Input"
                      count={audioInputs.length}
                      open={sourceSectionsOpen.input}
                      onOpenChange={(open) => setSourceSectionOpen("input", open)}
                      selectedSummary={selectedInputSummary}
                    >
                      {audioInputs.map((device) => (
                        <AudioDeviceOption
                          key={device.id}
                          device={device}
                          selected={safeAudioDeviceId === device.id}
                          onSelect={() => handleSourceSelect(device.id)}
                        />
                      ))}
                    </SourceSection>
                  ) : null}
                  {captureApplications.length ? (
                    <SourceSection
                      id="source-application-list"
                      label="Applications"
                      count={captureApplications.length}
                      open={sourceSectionsOpen.applications}
                      onOpenChange={(open) => setSourceSectionOpen("applications", open)}
                      selectedSummary={selectedApplication}
                    >
                      {captureApplications.map((application) => (
                        <SourceRow
                          key={application.id}
                          ariaLabel={`${application.label} application audio`}
                          primary={application.label}
                          secondary={application.windowTitle}
                          selected={safeAudioDeviceId === application.id}
                          onSelect={() => handleSourceSelect(application.id)}
                        />
                      ))}
                    </SourceSection>
                  ) : null}
                </div>
              </PopoverContent>
            </Popover>
          ))}
        <Popover onOpenChange={autoHideControls ? holdFocusControls : undefined}>
          <PopoverTrigger asChild>
            <span className="group">
              <IconButton
                icon={<Gauge className="size-[length:var(--ui-icon-shell-action)]" />}
                tip="Loudness Profile"
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
                className={TOOLBAR_TRIGGER_OPEN_CLASS}
              />
            </span>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className={TOOLBAR_POPOVER_CLASS}>
            <FocusViewPopoverContent
              pinned={pinned}
              setPinned={setPinned}
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
                className={TOOLBAR_TRIGGER_OPEN_CLASS}
              />
            </span>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className={TOOLBAR_POPOVER_CLASS}>
            <PresetsPopoverContent
              presets={presets}
              onExport={(id) => onExportLibraryItem("presets", id)}
            />
          </PopoverContent>
        </Popover>
        <IconButton
          icon={<Settings className="size-[length:var(--ui-icon-shell-action)]" />}
          tip="Settings"
          onClick={() => setSettingsOpen(true)}
        />
      </div>
    </header>
  );
}
