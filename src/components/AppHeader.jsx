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
import { IconButton } from "./IconButton.jsx";
import { SourceTransportCluster } from "./SourceTransportCluster.jsx";
import { PresetsPopoverContent } from "./PresetsPopover.jsx";
import { LoudnessProfilePopoverContent } from "./LoudnessProfilePopover.jsx";
import { FocusViewPopoverContent } from "./FocusViewPopover.jsx";
import { ModulesPopoverContent } from "../workspace/WorkspaceToolbar.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SHELL_HEADER, SHELL_HEADER_ACTIONS, SHELL_HEADER_OVERLAY } from "@/lib/shellLayout";
import { formatAudioDeviceLabel } from "@/lib/audioDeviceLabels.js";
import { cn } from "@/lib/utils";

function DeviceRow({ primary, secondary, selected, onSelect, ariaLabel }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-[length:var(--ui-fs-control)] transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          selected ? "bg-primary" : "bg-muted-foreground/20"
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground">{primary}</span>
        {secondary ? (
          <span className="mt-0.5 block truncate text-muted-foreground/70">{secondary}</span>
        ) : null}
      </span>
    </button>
  );
}

function AudioDeviceOption({ device, selected, onSelect }) {
  const label = formatAudioDeviceLabel(device.label);
  return (
    <DeviceRow
      ariaLabel={label.full}
      primary={label.primary}
      secondary={label.secondary}
      selected={selected}
      onSelect={onSelect}
    />
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
  safeAudioDeviceId,
  setCaptureDeviceId,
  holdFocusControls,
  focusView,
  focusViewActive,
  pinned,
  setPinned,
  setAutoHideControls,
  setCompactPanels,
  setBorderless,
  panelOpacity,
  setPanelOpacity,
  glassEnabled,
  setGlassEnabled,
  showDock,
  dockEdge,
  onDockChange,
  dockDisabled,
  presets,
  setSettingsOpen,
}) {
  const [devicesOpen, setDevicesOpen] = useState(false);

  const handleDeviceSelect = (id) => {
    setCaptureDeviceId(id);
    setDevicesOpen(false);
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
        onPrimaryAction={onSourceTransportAction}
      />
      {notice ? (
        <div
          title={notice.details ?? notice.text}
          className={cn(
            "min-w-0 max-w-[min(30rem,34vw)] truncate text-[length:var(--ui-fs-status)] font-medium",
            notice.kind === "error" ? "text-[color:var(--ui-signal-bad)]" : "text-muted-foreground"
          )}
        >
          {notice.text}
        </div>
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
            // Reuse the Devices slot (meaningless in File mode) as a re-import affordance,
            // mirroring the ANALYZE picker without adding a new toolbar control.
            <IconButton
              icon={<FolderOpen className="size-[length:var(--ui-icon-shell-action)] shrink-0" />}
              tip="Open file"
              onClick={onOpenFile}
            />
          ) : (
            <Popover
              open={devicesOpen}
              onOpenChange={(open) => {
                if (open && !audioDevices.length) return;
                setDevicesOpen(open);
                if (autoHideControls) holdFocusControls(open);
              }}
            >
              <PopoverTrigger asChild>
                <span>
                  <IconButton
                    icon={
                      <Volume2 className="size-[length:var(--ui-icon-shell-action)] shrink-0" />
                    }
                    tip="Devices"
                    disabled={!audioDevices.length}
                  />
                </span>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="w-auto max-w-[92vw] p-1">
                <p className="px-2 py-1 text-[length:var(--ui-fs-caption)] font-semibold tracking-wide text-muted-foreground">
                  Devices
                </p>
                <DeviceRow
                  ariaLabel="Automatic (default system output)"
                  primary="Automatic (default system output)"
                  selected={safeAudioDeviceId === "default"}
                  onSelect={() => handleDeviceSelect("default")}
                />
                {audioOutputs.length ? (
                  <>
                    <p className="px-2 pt-1 text-[length:var(--ui-fs-caption)] font-semibold tracking-wide text-muted-foreground/70">
                      Output
                    </p>
                    {audioOutputs.map((device) => (
                      <AudioDeviceOption
                        key={device.id}
                        device={device}
                        selected={safeAudioDeviceId === device.id}
                        onSelect={() => handleDeviceSelect(device.id)}
                      />
                    ))}
                  </>
                ) : null}
                {audioInputs.length ? (
                  <>
                    <p className="px-2 pt-1 text-[length:var(--ui-fs-caption)] font-semibold tracking-wide text-muted-foreground/70">
                      Input
                    </p>
                    {audioInputs.map((device) => (
                      <AudioDeviceOption
                        key={device.id}
                        device={device}
                        selected={safeAudioDeviceId === device.id}
                        onSelect={() => handleDeviceSelect(device.id)}
                      />
                    ))}
                  </>
                ) : null}
              </PopoverContent>
            </Popover>
          ))}
        <Popover onOpenChange={autoHideControls ? holdFocusControls : undefined}>
          <PopoverTrigger asChild>
            <span>
              <IconButton
                icon={<Gauge className="size-[length:var(--ui-icon-shell-action)]" />}
                tip="Loudness Profile"
                className={loudnessProfile?.active !== "off" ? "text-foreground" : undefined}
              />
            </span>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-64 p-1">
            <LoudnessProfilePopoverContent profile={loudnessProfile} stats={loudnessProfileStats} />
          </PopoverContent>
        </Popover>
        <Popover onOpenChange={autoHideControls ? holdFocusControls : undefined}>
          <PopoverTrigger asChild>
            <span>
              <IconButton
                icon={<LayoutGrid className="size-[length:var(--ui-icon-shell-action)]" />}
                tip="Modules"
              />
            </span>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-max min-w-44 max-w-[92vw] p-1">
            <p className="px-2 py-1 text-[length:var(--ui-fs-caption)] font-semibold tracking-wide text-muted-foreground">
              Modules
            </p>
            <ModulesPopoverContent />
          </PopoverContent>
        </Popover>
        <Popover onOpenChange={autoHideControls ? holdFocusControls : undefined}>
          <PopoverTrigger asChild>
            <span>
              <IconButton
                icon={<Focus className="size-[length:var(--ui-icon-shell-action)]" />}
                tip="Views"
                className={focusViewActive ? "text-foreground" : undefined}
              />
            </span>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-56 p-1">
            <FocusViewPopoverContent
              pinned={pinned}
              setPinned={setPinned}
              focusView={focusView}
              setAutoHideControls={setAutoHideControls}
              setCompactPanels={setCompactPanels}
              setBorderless={setBorderless}
              panelOpacity={panelOpacity}
              setPanelOpacity={setPanelOpacity}
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
            <span>
              <IconButton
                icon={<Bookmark className="size-[length:var(--ui-icon-shell-action)]" />}
                tip="Presets"
              />
            </span>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-60 p-1">
            <PresetsPopoverContent presets={presets} />
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
