import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CircleHelp, ExternalLink, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { COMPACT_SWITCH_CLASS, COMPACT_SWITCH_THUMB_CLASS } from "@/components/ui/controlStyles.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ResetAction } from "@/components/ResetAction.jsx";
import { ConfirmDialog } from "@/components/ConfirmDialog.jsx";
import { HoverTip } from "@/components/HoverTip.jsx";
import { ShortcutCapture } from "./ShortcutCapture.jsx";
import { KEYBOARD_SHORTCUTS } from "@/data/keyboardShortcuts.js";
import { formatAcceleratorForDisplay } from "@/lib/accelerator.js";
import { DEFAULT_CLEAR_SHORTCUT } from "@/lib/clearShortcutPrefs.js";
import { CHANNEL_ROLE_VOCABULARY } from "@/math/channelRoles.js";
import { layoutsForChannelCount } from "@/math/channelLayoutTable.js";
import { INTERFACE_SIZE_OPTIONS } from "@/settings/defaults.js";
import { ThemePicker } from "./ThemePicker.jsx";
import { CopyableTextBlock } from "./CopyableTextBlock.jsx";
import {
  DIALOGUE_VAD_ENGINE_OPTIONS,
  DEFAULT_DIALOGUE_VAD_ENGINE,
} from "@/lib/dialogueVadEngines.js";
const RELEASES_URL = "https://github.com/SounDoer/PLVS/releases";
const DOCS_URL = "https://plvs.soundoer.com/docs/";
const AGENT_CONTROL_PROMPT_STARTER =
  "Use PLVS’s built-in Agent Control CLI (`plvs-cli`). First inspect the available capabilities and current app state, then help me...";

const SHEET_CLASS = "settings-sheet gap-0 overflow-hidden border-border bg-card p-0";

const SHEET_HEADER_CLASS =
  "flex shrink-0 items-center justify-between border-b border-border px-[var(--ui-drawer-pad)] py-2";

const SHEET_SCROLL_CLASS = "min-h-0 flex-1 overflow-y-auto p-[var(--ui-drawer-pad)]";

const BODY_CLASS = "flex flex-col gap-[var(--ui-drawer-gap)] text-[length:var(--ui-fs-display)]";

const SECTION_CLASS = "flex flex-col gap-[var(--ui-drawer-row-gap)]";

const ROW_CLASS =
  "grid min-h-[var(--ui-drawer-row-min-h)] grid-cols-[minmax(0,1fr)_max-content] items-center gap-2 rounded-xs px-1.5 py-0.5";

const ROW_LABEL_CLASS =
  "whitespace-nowrap text-[length:var(--ui-fs-display)] text-muted-foreground";

const ROW_VALUE_CLASS = "flex min-w-0 items-center justify-end";

const SELECT_TRIGGER_CLASS =
  "h-auto min-h-6 w-auto shrink-0 rounded-md border border-transparent bg-transparent py-0.5 !pr-0 !pl-2 text-[length:var(--ui-fs-display)] shadow-none outline-none transition-colors hover:border-border hover:bg-ui-hover";

const SELECT_CONTENT_CLASS =
  "min-w-[var(--radix-select-trigger-width)] [&_[data-slot=select-item]]:py-1 [&_[data-slot=select-item]]:pr-6 [&_[data-slot=select-item]]:pl-2 [&_[data-slot=select-item]]:text-[length:var(--ui-fs-display)]";

const SWITCH_CLASS = COMPACT_SWITCH_CLASS;

const SWITCH_THUMB_CLASS = COMPACT_SWITCH_THUMB_CLASS;

const ICON_BTN_CLASS =
  "rounded-xs p-0.5 text-muted-foreground transition-colors hover:text-foreground";

const KBD_ROW_CLASS = "flex items-center justify-between gap-2 px-1.5 py-0.5";

const FOOTER_LINK_CLASS =
  "inline-flex h-auto items-center gap-1 whitespace-nowrap bg-transparent px-0 py-0 text-[length:var(--ui-fs-metric-meta)] text-muted-foreground transition-colors hover:text-foreground cursor-pointer border-none outline-none disabled:cursor-default disabled:opacity-50";

const CONFIG_ACTION_BTN_CLASS = "h-7 px-2 text-[length:var(--ui-fs-control)]";

function SettingsBody({ children }) {
  return (
    <div data-settings-body className={BODY_CLASS}>
      {children}
    </div>
  );
}

function SettingsSection({ children, className }) {
  return (
    <div data-settings-section className={cn(SECTION_CLASS, className)}>
      {children}
    </div>
  );
}

function SettingsRow({ children, label, labelNode, className, ...props }) {
  return (
    <div data-settings-row className={cn(ROW_CLASS, className)} {...props}>
      {labelNode ?? <span className={ROW_LABEL_CLASS}>{label}</span>}
      <div data-settings-row-value className={ROW_VALUE_CLASS}>
        {children}
      </div>
    </div>
  );
}

function SettingsLabelWithTip({ label, tip }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className={ROW_LABEL_CLASS}>{label}</span>
      <HoverTip
        tip={tip}
        side="bottom"
        align="start"
        className="inline-flex shrink-0"
        tipClassName="w-max max-w-[18rem] whitespace-normal"
      >
        <button
          type="button"
          aria-label={`${label} help: ${tip}`}
          className="rounded-xs p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <CircleHelp className="size-[1em]" aria-hidden />
        </button>
      </HoverTip>
    </div>
  );
}

function SettingsDivider() {
  return <div className="border-t border-border" />;
}

function SettingsSwitch({ className, ...props }) {
  return (
    <Switch
      className={cn(SWITCH_CLASS, className)}
      thumbClassName={SWITCH_THUMB_CLASS}
      {...props}
    />
  );
}

function IconButton({ children, className, ...props }) {
  return (
    <button type="button" className={cn(ICON_BTN_CLASS, className)} {...props}>
      {children}
    </button>
  );
}

export function SettingsPanel({
  settingsOpen,
  setSettingsOpen,
  appearance,
  setAppearanceMode,
  interfaceSize = "default",
  setInterfaceSize = () => {},
  fixedThemeSelectValue,
  setFixedThemeIdFromPicker,
  appVersion,
  latestVersion,
  releaseUrl,
  hasUpdate = false,
  updateStatus = latestVersion ? "ok" : "checking",
  onCheckForUpdate = () => {},
  onInstallUpdate = () => {},
  openExternalUrl = () => {},
  autostartEnabled = false,
  setAutostartEnabled = () => {},
  autostartReady = false,
  closeAction = "ask",
  setCloseAction = () => {},
  historyRetentionSec = 3600,
  setHistoryRetentionSec = () => {},
  dialogueVadEngine = DEFAULT_DIALOGUE_VAD_ENGINE,
  setDialogueVadEngine = () => {},
  clearShortcut = "CmdOrCtrl+K",
  setClearShortcut = () => {},
  clearGlobal = false,
  setClearGlobal = () => {},
  setClearCapturing = () => {},
  clearReady = false,
  registrationError = null,
  channelCount = 0,
  channelLabelTokens = [],
  channelLabelHasOverride = false,
  selectedLayoutId = null,
  setChannelLayout = () => {},
  setChannelLabelToken = () => {},
  resetChannelLabels = () => {},
  customThemeOptions = [],
  createCustomTheme = () => {},
  editCustomTheme = () => {},
  customizeBuiltinTheme = () => {},
  duplicateCustomTheme = () => {},
  deleteCustomTheme = () => {},
  onExportTheme = () => {},
  themeControlsDisabled = false,
  onExportConfiguration = () => {},
  onImportConfiguration = () => {},
  onResetConfiguration = () => {},
  configurationBusy = false,
  configurationStatus = "",
  onLibraryExport = () => {},
  onSharedPackImport = () => {},
  packBusy = false,
  packStatus = "",
  agentControlStatus = undefined,
  agentControlBusy = false,
  onSetAgentControlEnabled = () => {},
  askToSendCrashReports = true,
  crashReportSettingBusy = false,
  crashReportSettingError = "",
  onAskToSendCrashReports = () => {},
  onOpenFeedback = () => {},
}) {
  const reduceMotion = useReducedMotion();
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac/i.test(navigator.platform || navigator.userAgent || "");
  const [sheetBodyVisible, setSheetBodyVisible] = useState(settingsOpen);
  // Reset wipes every library and relaunches, so it gets a modal that can say so. Per-setting
  // resets use the compact inline confirmation shared with the rest of the app.
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const closingIntentRef = useRef(false);
  const effectiveReleaseUrl = releaseUrl || RELEASES_URL;
  const updateCheckDisabled = updateStatus === "checking";
  let updateStatusText = "Checking...";
  if (updateStatus === "unavailable") {
    updateStatusText = "Update unavailable";
  } else if (updateStatus === "ok") {
    updateStatusText = hasUpdate && latestVersion ? `v${latestVersion} available` : "Up to date";
  }
  const showAgentControl = agentControlStatus !== undefined;
  const agentControlSupported = !!agentControlStatus?.supported;
  const agentControlInstalled = !!agentControlStatus?.cliInstalled;
  const agentControlEnabled = !!agentControlStatus?.enabled;
  const agentControlDisabled = agentControlBusy || !agentControlSupported || !agentControlInstalled;
  const agentControlMessage = agentControlStatus?.message ?? "Checking Agent Control...";
  // The switch shows the permission the user granted; the endpoint can fail to open after it.
  // Without this line the two disagree in silence.
  const agentControlSilent = agentControlEnabled && !agentControlStatus?.listening;
  const agentControlStartError = agentControlStatus?.startError ?? "";
  const selectedDialogueVadEngine =
    DIALOGUE_VAD_ENGINE_OPTIONS.find((option) => option.id === dialogueVadEngine) ??
    DIALOGUE_VAD_ENGINE_OPTIONS[0];
  const channelLayouts = layoutsForChannelCount(channelCount);
  const selectedStandardLayout = channelLayouts.find((layout) => layout.id === selectedLayoutId);
  const showChannelLayoutSelect =
    channelLayouts.length > 1 ||
    (channelLayouts.length === 1 && (selectedLayoutId === null || selectedLayoutId === "custom"));
  const channelLayoutLabel =
    selectedLayoutId === "custom"
      ? "Custom"
      : (selectedStandardLayout?.name ?? selectedLayoutId ?? "Unknown");

  useLayoutEffect(() => {
    if (settingsOpen) {
      closingIntentRef.current = false;
      setSheetBodyVisible(true);
      return;
    }
    if (!closingIntentRef.current) {
      setSheetBodyVisible(false);
    }
  }, [settingsOpen]);

  const handleOpenChange = (open) => {
    if (open) {
      closingIntentRef.current = false;
      setSettingsOpen(true);
      setSheetBodyVisible(true);
      return;
    }
    closingIntentRef.current = true;
    setSheetBodyVisible(false);
  };

  return (
    <Sheet open={settingsOpen} onOpenChange={handleOpenChange}>
      <SheetContent side="right" hideClose aria-describedby={undefined} className={SHEET_CLASS}>
        <div data-settings-header className={SHEET_HEADER_CLASS}>
          <SheetTitle className="text-[length:var(--ui-fs-panel-title)]">Settings</SheetTitle>
          <SheetClose
            type="button"
            aria-label="Close settings"
            className={cn(ICON_BTN_CLASS, "p-1")}
          >
            <X className="size-[length:var(--ui-icon-shell-action)]" />
          </SheetClose>
        </div>
        <AnimatePresence
          onExitComplete={() => {
            if (closingIntentRef.current) {
              closingIntentRef.current = false;
              setSettingsOpen(false);
            }
          }}
        >
          {sheetBodyVisible ? (
            <motion.div
              key="settings-inner"
              data-settings-scroll
              className={SHEET_SCROLL_CLASS}
              initial={reduceMotion ? false : { opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={
                reduceMotion
                  ? { opacity: 1 }
                  : { opacity: 0, x: 14, transition: { duration: 0.12, ease: "easeIn" } }
              }
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 420, damping: 36, mass: 0.35 }
              }
            >
              <SettingsBody>
                {/* Behavior */}
                <SettingsSection>
                  <SettingsRow label="Open at Login">
                    <SettingsSwitch
                      aria-label="Open at Login"
                      checked={autostartEnabled}
                      onCheckedChange={setAutostartEnabled}
                      disabled={!autostartReady}
                    />
                  </SettingsRow>
                  <SettingsRow label="Close Behavior">
                    <Select value={closeAction} onValueChange={setCloseAction}>
                      <SelectTrigger aria-label="Close Behavior" className={SELECT_TRIGGER_CLASS}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper" className={SELECT_CONTENT_CLASS}>
                        <SelectItem value="ask">Ask Each Time</SelectItem>
                        <SelectItem value="tray">Minimize to Tray</SelectItem>
                        <SelectItem value="quit">Quit</SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingsRow>
                  <SettingsRow
                    labelNode={
                      <SettingsLabelWithTip
                        label="Ask To Send Crash Reports"
                        tip="Saves crash reports locally either way. When enabled, PLVS asks before sending one after a crash."
                      />
                    }
                  >
                    <SettingsSwitch
                      aria-label="ask to send crash reports"
                      checked={askToSendCrashReports}
                      disabled={crashReportSettingBusy}
                      onCheckedChange={(next) => {
                        void Promise.resolve(onAskToSendCrashReports(next)).catch(() => {});
                      }}
                    />
                  </SettingsRow>
                  {crashReportSettingError ? (
                    <span className="px-1.5 text-right text-[length:var(--ui-fs-axis)] text-destructive">
                      Could not update crash-report settings.
                    </span>
                  ) : null}
                </SettingsSection>

                <SettingsDivider />

                {/* Keyboard shortcuts */}
                <SettingsSection>
                  {KEYBOARD_SHORTCUTS.map((s) => (
                    <div key={s.id} className={KBD_ROW_CLASS}>
                      <span className="text-muted-foreground">{s.label}</span>
                      <span className="font-mono tabular-nums text-muted-foreground text-[length:var(--ui-fs-metric-meta)]">
                        {formatAcceleratorForDisplay(s.keys, { isMac })}
                      </span>
                    </div>
                  ))}
                  <SettingsRow label="Clear">
                    <div className="flex items-center gap-1.5">
                      <ShortcutCapture
                        value={clearShortcut}
                        onChange={setClearShortcut}
                        onRecordingChange={setClearCapturing}
                        isMac={isMac}
                        disabled={!clearReady}
                      />
                      <ResetAction
                        label="Reset clear shortcut"
                        isDefault={!clearReady || clearShortcut === DEFAULT_CLEAR_SHORTCUT}
                        onReset={() => setClearShortcut(DEFAULT_CLEAR_SHORTCUT)}
                        confirmLabel="Confirm reset clear shortcut"
                        cancelLabel="Cancel reset clear shortcut"
                      />
                    </div>
                  </SettingsRow>
                  {registrationError ? (
                    <div className="text-right text-[length:var(--ui-fs-axis)] text-destructive px-1.5">
                      Combo unavailable, try another
                    </div>
                  ) : null}
                  <SettingsRow label="Global Shortcut">
                    <SettingsSwitch
                      aria-label="Global Shortcut"
                      checked={clearGlobal}
                      onCheckedChange={setClearGlobal}
                      disabled={!clearReady}
                      className={cn(registrationError && "border-destructive")}
                    />
                  </SettingsRow>
                </SettingsSection>

                <SettingsDivider />

                {/* Appearance */}
                <SettingsSection>
                  <SettingsRow
                    labelNode={
                      <SettingsLabelWithTip
                        label="Interface Size"
                        tip="Adjusts text and related interface icons. Dock is unaffected."
                      />
                    }
                  >
                    <Select value={interfaceSize} onValueChange={setInterfaceSize}>
                      <SelectTrigger aria-label="Interface Size" className={SELECT_TRIGGER_CLASS}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper" className={SELECT_CONTENT_CLASS}>
                        {INTERFACE_SIZE_OPTIONS.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </SettingsRow>
                  {themeControlsDisabled ? (
                    <span className="px-1.5 text-[length:var(--ui-fs-axis)] text-muted-foreground">
                      Finish editing the current theme before changing theme settings.
                    </span>
                  ) : null}
                  <SettingsRow label="Appearance">
                    <Select
                      value={appearance}
                      onValueChange={setAppearanceMode}
                      disabled={themeControlsDisabled}
                    >
                      <SelectTrigger
                        aria-label="Appearance"
                        className={SELECT_TRIGGER_CLASS}
                        disabled={themeControlsDisabled}
                      >
                        <SelectValue placeholder="Appearance" />
                      </SelectTrigger>
                      <SelectContent position="popper" className={SELECT_CONTENT_CLASS}>
                        <SelectItem value="system">Follow System</SelectItem>
                        <SelectItem value="fixed">Fixed Theme</SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingsRow>
                  {appearance === "fixed" ? (
                    <div
                      role="group"
                      aria-label="Theme picker"
                      className="flex min-h-6 items-center gap-1 px-1.5 py-0.5"
                    >
                      <span className={ROW_LABEL_CLASS}>Theme</span>
                      <div className="flex-1" />
                      <ThemePicker
                        value={fixedThemeSelectValue}
                        onSelect={setFixedThemeIdFromPicker}
                        customThemes={customThemeOptions
                          .map((option) => option.theme)
                          .filter(Boolean)}
                        onCustomize={customizeBuiltinTheme}
                        onEdit={editCustomTheme}
                        onDuplicate={duplicateCustomTheme}
                        onExport={onExportTheme}
                        onDelete={deleteCustomTheme}
                        onCreate={createCustomTheme}
                        disabled={themeControlsDisabled}
                      />
                    </div>
                  ) : null}
                </SettingsSection>

                <SettingsDivider />

                {/* History retention */}
                <SettingsSection>
                  <SettingsRow
                    labelNode={
                      <SettingsLabelWithTip
                        label="History Length"
                        tip="How far back the history panels can be scrolled. Changing it does not restart the measurement; shortening it drops rows older than the new length."
                      />
                    }
                  >
                    <Select
                      value={String(historyRetentionSec)}
                      onValueChange={setHistoryRetentionSec}
                    >
                      <SelectTrigger aria-label="History Length" className={SELECT_TRIGGER_CLASS}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper" className={SELECT_CONTENT_CLASS}>
                        <SelectItem value="1800">30 min</SelectItem>
                        <SelectItem value="3600">60 min</SelectItem>
                        <SelectItem value="7200">120 min</SelectItem>
                        <SelectItem value="14400">240 min</SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingsRow>
                  <SettingsRow
                    labelNode={
                      <SettingsLabelWithTip
                        label="Dialogue Detection"
                        tip="The detector behind the Stats dialogue metrics. Showing one of those metrics is what switches it on; changing the detector restarts the measurement."
                      />
                    }
                  >
                    <Select value={dialogueVadEngine} onValueChange={setDialogueVadEngine}>
                      <div
                        data-integrated-select-action
                        className="group relative rounded-md transition-colors hover:bg-ui-hover"
                      >
                        <SelectTrigger
                          aria-label="Dialogue Detection"
                          className={cn(SELECT_TRIGGER_CLASS, "!gap-1 !pl-2 hover:bg-transparent")}
                        >
                          <SelectValue />
                          <span aria-hidden className="size-[1em] shrink-0" />
                        </SelectTrigger>
                        <IconButton
                          aria-label={`Open ${selectedDialogueVadEngine.label} official link`}
                          className="absolute top-1/2 right-[calc(1.15em+0.25rem)] -translate-y-1/2"
                          onClick={() => openExternalUrl(selectedDialogueVadEngine.url)}
                        >
                          <ExternalLink className="size-[1em]" />
                        </IconButton>
                      </div>
                      <SelectContent position="popper" className={SELECT_CONTENT_CLASS}>
                        {DIALOGUE_VAD_ENGINE_OPTIONS.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </SettingsRow>
                </SettingsSection>

                <SettingsDivider />

                {/* Channel labels */}
                <SettingsSection>
                  <SettingsRow
                    labelNode={
                      <span className={ROW_LABEL_CLASS}>
                        Channels{channelCount > 0 ? ` · ${channelCount}ch` : ""}
                      </span>
                    }
                  >
                    {channelCount > 0 ? (
                      <ResetAction
                        label="Reset channel labels"
                        isDefault={!channelLabelHasOverride}
                        onReset={resetChannelLabels}
                        confirmLabel="Confirm reset channel labels"
                        cancelLabel="Cancel reset channel labels"
                      />
                    ) : null}
                  </SettingsRow>
                  {channelCount > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      <SettingsRow labelNode={<span className={ROW_LABEL_CLASS}>Layout</span>}>
                        {showChannelLayoutSelect ? (
                          <Select value={selectedLayoutId ?? ""} onValueChange={setChannelLayout}>
                            <SelectTrigger
                              className={SELECT_TRIGGER_CLASS}
                              aria-label="channel layout"
                            >
                              <SelectValue placeholder="Unknown" />
                            </SelectTrigger>
                            <SelectContent position="popper" className={SELECT_CONTENT_CLASS}>
                              {channelLayouts.map((layout) => (
                                <SelectItem key={layout.id} value={layout.id}>
                                  {layout.name}
                                </SelectItem>
                              ))}
                              {selectedLayoutId === "custom" ? (
                                <SelectItem value="custom">Custom</SelectItem>
                              ) : null}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span aria-label="channel layout" className="py-0.5 pl-2">
                            {channelLayoutLabel}
                          </span>
                        )}
                      </SettingsRow>
                      {channelLabelTokens.map((token, i) => (
                        <SettingsRow
                          key={i}
                          labelNode={
                            <span className="shrink-0 tabular-nums font-mono text-[length:var(--ui-fs-axis)] text-muted-foreground">
                              {i + 1}
                            </span>
                          }
                        >
                          <Select value={token} onValueChange={(v) => setChannelLabelToken(i, v)}>
                            <SelectTrigger
                              className={SELECT_TRIGGER_CLASS}
                              aria-label={`Channel ${i + 1} role`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper" className={SELECT_CONTENT_CLASS}>
                              {CHANNEL_ROLE_VOCABULARY.map((role) => (
                                <SelectItem key={role.id} value={role.id}>
                                  {role.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </SettingsRow>
                      ))}
                    </div>
                  ) : (
                    <span className="px-1.5 text-[length:var(--ui-fs-axis)] text-muted-foreground">
                      Connect an input to label its channels.
                    </span>
                  )}
                </SettingsSection>

                <SettingsDivider />

                {/* Import, export and reset */}
                <SettingsSection>
                  <SettingsRow
                    labelNode={
                      <SettingsLabelWithTip
                        label="Saved Items"
                        tip="Loudness Profiles, Presets and Themes. Export lets you choose saved items; Import adds them without replacing your current setup."
                      />
                    }
                    className="settings-row-stackable"
                  >
                    <div className="flex items-center gap-2.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={onLibraryExport}
                        disabled={packBusy}
                        aria-label="Export saved items"
                        className={CONFIG_ACTION_BTN_CLASS}
                      >
                        Export…
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={onSharedPackImport}
                        disabled={packBusy}
                        aria-label="Import saved items"
                        className={CONFIG_ACTION_BTN_CLASS}
                      >
                        Import…
                      </Button>
                    </div>
                  </SettingsRow>
                  {packStatus ? (
                    <div className="px-1.5 text-right text-[length:var(--ui-fs-axis)] text-muted-foreground">
                      {packStatus}
                    </div>
                  ) : null}
                  <SettingsRow
                    labelNode={
                      <SettingsLabelWithTip
                        label="Complete Setup"
                        tip="One file containing all settings and saved items. Import replaces your current setup and restarts PLVS."
                      />
                    }
                    className="settings-row-stackable"
                  >
                    <div className="flex items-center gap-2.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={onExportConfiguration}
                        disabled={configurationBusy}
                        aria-label="Export complete setup"
                        className={CONFIG_ACTION_BTN_CLASS}
                      >
                        Export…
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={onImportConfiguration}
                        disabled={configurationBusy}
                        aria-label="Import complete setup"
                        className={CONFIG_ACTION_BTN_CLASS}
                      >
                        Import…
                      </Button>
                    </div>
                  </SettingsRow>
                  {/* No label: the button says what it does, and leaving the label column empty
                      keeps it on the same right-hand column as the Import buttons above. */}
                  <SettingsRow label="" className="settings-row-stackable">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setResetConfirmOpen(true)}
                      disabled={configurationBusy}
                      aria-label="Reset PLVS to default"
                      className={cn(
                        CONFIG_ACTION_BTN_CLASS,
                        "text-muted-foreground hover:text-destructive focus-visible:text-destructive active:text-destructive"
                      )}
                    >
                      Reset PLVS to Default
                    </Button>
                  </SettingsRow>
                  {configurationStatus ? (
                    <div className="px-1.5 text-right text-[length:var(--ui-fs-axis)] text-muted-foreground">
                      {configurationStatus}
                    </div>
                  ) : null}
                </SettingsSection>

                {showAgentControl ? (
                  <>
                    <SettingsDivider />

                    {/* Agent control */}
                    <SettingsSection>
                      <SettingsRow
                        labelNode={
                          <SettingsLabelWithTip label="Agent Control" tip={agentControlMessage} />
                        }
                      >
                        <SettingsSwitch
                          aria-label="Agent Control"
                          checked={agentControlEnabled}
                          disabled={agentControlDisabled}
                          onCheckedChange={(next) => onSetAgentControlEnabled(next)}
                        />
                      </SettingsRow>
                      {agentControlSilent ? (
                        <div className="px-1.5 text-right text-[length:var(--ui-fs-axis)] text-destructive">
                          {agentControlStartError
                            ? `Enabled, but not listening: ${agentControlStartError}`
                            : "Enabled, but not listening."}
                        </div>
                      ) : null}
                      {agentControlEnabled ? (
                        <div className="flex flex-col gap-1.5 px-1.5">
                          <span className={ROW_LABEL_CLASS}>Prompt Starter</span>
                          <CopyableTextBlock
                            value={AGENT_CONTROL_PROMPT_STARTER}
                            ariaLabel="copy agent control prompt starter"
                          />
                        </div>
                      ) : null}
                    </SettingsSection>
                  </>
                ) : null}

                {/* Footer */}
                {appVersion ? (
                  <>
                    <SettingsDivider />
                    <div
                      data-settings-footer
                      className="flex flex-col gap-1 px-1.5 text-[length:var(--ui-fs-metric-meta)]"
                    >
                      <div
                        data-settings-footer-status
                        className="flex items-center justify-start gap-1.5 whitespace-nowrap"
                      >
                        <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                          v{appVersion}
                        </span>
                        <span className="h-3 shrink-0 border-l border-border" aria-hidden="true" />
                        <span
                          className={cn(
                            "truncate",
                            hasUpdate ? "text-primary" : "text-muted-foreground"
                          )}
                        >
                          {updateStatusText}
                        </span>
                        <span className="h-3 shrink-0 border-l border-border" aria-hidden="true" />
                        <button
                          type="button"
                          className={FOOTER_LINK_CLASS}
                          disabled={updateCheckDisabled}
                          onClick={onCheckForUpdate}
                        >
                          Check
                        </button>
                        {hasUpdate ? (
                          <>
                            <span
                              className="h-3 shrink-0 border-l border-border"
                              aria-hidden="true"
                            />
                            <button
                              type="button"
                              className={cn(FOOTER_LINK_CLASS, "text-primary hover:text-primary")}
                              onClick={onInstallUpdate}
                            >
                              Update
                            </button>
                          </>
                        ) : null}
                      </div>
                      <div
                        data-settings-footer-links
                        className="flex flex-wrap items-center justify-start gap-x-3 gap-y-1"
                      >
                        <button
                          type="button"
                          className={cn(
                            FOOTER_LINK_CLASS,
                            hasUpdate && "text-primary hover:text-primary"
                          )}
                          onClick={() => openExternalUrl(effectiveReleaseUrl)}
                        >
                          Releases
                          <ExternalLink className="size-[1em]" />
                        </button>
                        <button
                          type="button"
                          className={FOOTER_LINK_CLASS}
                          onClick={() => openExternalUrl(DOCS_URL)}
                        >
                          Docs
                          <ExternalLink className="size-[1em]" />
                        </button>
                        <button
                          type="button"
                          className={FOOTER_LINK_CLASS}
                          onClick={onOpenFeedback}
                        >
                          Feedback
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
              </SettingsBody>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </SheetContent>
      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title="Reset PLVS to Default?"
        description="Every setting, preset, theme and loudness profile is erased and PLVS restarts. This cannot be undone."
        confirmLabel="Reset PLVS"
        onConfirm={onResetConfiguration}
      />
    </Sheet>
  );
}
