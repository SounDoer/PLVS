import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ExternalLink, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
import { ShortcutCapture } from "./ShortcutCapture.jsx";
import { KEYBOARD_SHORTCUTS } from "@/data/keyboardShortcuts.js";
import { formatAcceleratorForDisplay } from "@/lib/accelerator.js";
import { DEFAULT_CLEAR_SHORTCUT } from "@/lib/clearShortcutPrefs.js";
import { CHANNEL_ROLE_VOCABULARY } from "@/math/channelRoles.js";
import { createPortal } from "react-dom";
import { FeedbackDialog } from "./FeedbackDialog.jsx";

const RELEASES_URL = "https://github.com/SounDoer/PLVS/releases";

const SHEET_CLASS =
  "w-full gap-0 overflow-y-auto border-border bg-card/95 p-[var(--ui-drawer-pad)] backdrop-blur-[24px] sm:max-w-sm";

const BODY_CLASS = "flex flex-col gap-[var(--ui-drawer-gap)] text-[length:var(--ui-fs-display)]";

const SECTION_CLASS = "flex flex-col gap-[var(--ui-drawer-row-gap)]";

const ROW_CLASS =
  "grid min-h-[var(--ui-drawer-row-min-h)] grid-cols-[max-content_minmax(0,1fr)] items-center gap-2 rounded px-1.5 py-0.5";

const ROW_LABEL_CLASS =
  "whitespace-nowrap text-[length:var(--ui-fs-display)] text-muted-foreground";

const ROW_VALUE_CLASS = "flex min-w-0 items-center justify-end";

const SELECT_TRIGGER_CLASS =
  "h-6 w-auto shrink-0 rounded-md border border-transparent bg-transparent px-2 py-0 text-[length:var(--ui-fs-display)] shadow-none outline-none transition-colors hover:border-border hover:bg-secondary/85 focus:ring-0 focus:ring-offset-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0";

const SELECT_CONTENT_CLASS =
  "border-border/50 min-w-[var(--radix-select-trigger-width)] [&_[data-slot=select-item]]:py-1 [&_[data-slot=select-item]]:pr-6 [&_[data-slot=select-item]]:pl-2 [&_[data-slot=select-item]]:text-[length:var(--ui-fs-display)] [&_[data-slot=select-item]]:hover:bg-secondary/85";

const SWITCH_CLASS =
  "h-4 w-7 border border-border/40 bg-secondary/85 transition-colors hover:border-border/70 hover:bg-muted-foreground/30 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:hover:border-primary data-[state=checked]:hover:bg-primary data-[state=unchecked]:bg-secondary/85 data-[state=unchecked]:hover:bg-muted-foreground/30 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0";

const SWITCH_THUMB_CLASS =
  "size-3 bg-popover-foreground/80 shadow-none data-[state=checked]:translate-x-3 data-[state=checked]:bg-background/95 data-[state=unchecked]:translate-x-0";

const ICON_BTN_CLASS =
  "rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const KBD_ROW_CLASS = "flex items-center justify-between gap-2 px-1.5 py-0.5";

const FOOTER_LINK_CLASS =
  "inline-flex h-auto items-center gap-1 whitespace-nowrap bg-transparent px-0 py-0 text-[length:var(--ui-fs-metric-meta)] text-muted-foreground/60 transition-colors hover:text-foreground cursor-pointer border-none outline-none disabled:cursor-default disabled:opacity-40";

const CONFIG_TEXT_BTN_CLASS =
  "h-auto bg-transparent px-0 py-0 text-[length:var(--ui-fs-display)] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

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
      <div className={ROW_VALUE_CLASS}>{children}</div>
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
  fixedThemeSelectValue,
  setFixedThemeIdFromPicker,
  themeSelectOptions,
  appVersion,
  latestVersion,
  releaseUrl,
  hasUpdate = false,
  updateStatus = latestVersion ? "ok" : "checking",
  onCheckForUpdate = () => {},
  openReleaseUrl = () => {},
  autostartEnabled = false,
  setAutostartEnabled = () => {},
  autostartReady = false,
  closeAction = "ask",
  setCloseAction = () => {},
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
  setChannelLabelToken = () => {},
  resetChannelLabels = () => {},
  customThemeOptions = [],
  createCustomTheme = () => {},
  editActiveCustomTheme = () => {},
  deleteCustomTheme = () => {},
  activeIsCustom = false,
  themeControlsDisabled = false,
  onExportConfiguration = () => {},
  onImportConfiguration = () => {},
  onResetConfiguration = () => {},
  configurationBusy = false,
  configurationStatus = "",
}) {
  const reduceMotion = useReducedMotion();
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac/i.test(navigator.platform || navigator.userAgent || "");
  const [sheetBodyVisible, setSheetBodyVisible] = useState(settingsOpen);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const closingIntentRef = useRef(false);
  const effectiveReleaseUrl = releaseUrl || RELEASES_URL;
  const updateCheckDisabled = updateStatus === "checking";
  let updateStatusText = "Checking...";
  if (updateStatus === "unavailable") {
    updateStatusText = "Update unavailable";
  } else if (!updateCheckDisabled && latestVersion) {
    updateStatusText = hasUpdate ? `v${latestVersion} available` : "Up to date";
  }

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
                </SettingsSection>

                <SettingsDivider />

                {/* Keyboard shortcuts */}
                <SettingsSection>
                  {KEYBOARD_SHORTCUTS.map((s) => (
                    <div key={s.id} className={KBD_ROW_CLASS}>
                      <span className="text-muted-foreground">{s.label}</span>
                      <span className="font-mono tabular-nums text-muted-foreground/60 text-[length:var(--ui-fs-metric-meta)]">
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
                      <InlineConfirm
                        onConfirm={() => setClearShortcut(DEFAULT_CLEAR_SHORTCUT)}
                        confirmLabel="Confirm reset clear shortcut"
                        cancelLabel="Cancel reset clear shortcut"
                        trigger={(arm) => (
                          <IconButton
                            disabled={!clearReady}
                            onClick={arm}
                            aria-label="Reset clear shortcut"
                          >
                            <RotateCcw className="size-3.5" />
                          </IconButton>
                        )}
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
                      className={cn(registrationError && "ring-2 ring-destructive")}
                    />
                  </SettingsRow>
                </SettingsSection>

                <SettingsDivider />

                {/* Appearance */}
                <SettingsSection>
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
                      <Select
                        value={fixedThemeSelectValue}
                        onValueChange={setFixedThemeIdFromPicker}
                        disabled={themeControlsDisabled}
                      >
                        <SelectTrigger
                          aria-label="Theme"
                          className={SELECT_TRIGGER_CLASS}
                          disabled={themeControlsDisabled}
                        >
                          <SelectValue placeholder="Theme" />
                        </SelectTrigger>
                        <SelectContent position="popper" className={SELECT_CONTENT_CLASS}>
                          {themeSelectOptions.map((opt) => (
                            <SelectItem key={opt.id} value={opt.id}>
                              {opt.label}
                            </SelectItem>
                          ))}
                          {customThemeOptions.map((opt) => (
                            <SelectItem key={opt.id} value={opt.id}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {activeIsCustom ? (
                        <>
                          <IconButton
                            disabled={themeControlsDisabled}
                            onClick={editActiveCustomTheme}
                            aria-label="Edit theme"
                          >
                            <Pencil className="size-3.5" />
                          </IconButton>
                          <InlineConfirm
                            onConfirm={() => deleteCustomTheme(fixedThemeSelectValue)}
                            confirmLabel="Confirm delete theme"
                            cancelLabel="Cancel delete theme"
                            trigger={(arm) => (
                              <IconButton
                                disabled={themeControlsDisabled}
                                onClick={arm}
                                aria-label="Delete theme"
                              >
                                <Trash2 className="size-3.5" />
                              </IconButton>
                            )}
                          />
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {appearance === "fixed" ? (
                    <div className="px-1.5 py-0.5">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={themeControlsDisabled}
                        onClick={createCustomTheme}
                        aria-label="New theme"
                        className="h-7 w-full px-2 text-[length:var(--ui-fs-display)]"
                      >
                        <Plus className="size-3.5" />
                        New Theme
                      </Button>
                    </div>
                  ) : null}
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
                      <InlineConfirm
                        onConfirm={resetChannelLabels}
                        confirmLabel="Confirm reset channel labels"
                        cancelLabel="Cancel reset channel labels"
                        trigger={(arm) => (
                          <IconButton
                            onClick={arm}
                            disabled={!channelLabelHasOverride}
                            aria-label="Reset channel labels"
                          >
                            <RotateCcw className="size-3.5" />
                          </IconButton>
                        )}
                      />
                    ) : null}
                  </SettingsRow>
                  {channelCount > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      {channelLabelTokens.map((token, i) => (
                        <SettingsRow
                          key={i}
                          labelNode={
                            <span className="shrink-0 tabular-nums font-mono text-[length:var(--ui-fs-axis)] text-muted-foreground/60">
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
                    <span className="px-1.5 text-[length:var(--ui-fs-axis)] text-muted-foreground/60">
                      Connect an input to label its channels.
                    </span>
                  )}
                </SettingsSection>

                <SettingsDivider />

                {/* Configuration */}
                <SettingsSection>
                  <SettingsRow label="Configuration">
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={onExportConfiguration}
                        disabled={configurationBusy}
                        aria-label="Export configuration"
                        className={CONFIG_TEXT_BTN_CLASS}
                      >
                        Export
                      </button>
                      <button
                        type="button"
                        onClick={onImportConfiguration}
                        disabled={configurationBusy}
                        aria-label="Import configuration"
                        className={CONFIG_TEXT_BTN_CLASS}
                      >
                        Import
                      </button>
                      <InlineConfirm
                        onConfirm={onResetConfiguration}
                        confirmLabel="Confirm reset configuration"
                        cancelLabel="Cancel reset configuration"
                        trigger={(arm) => (
                          <IconButton
                            onClick={arm}
                            disabled={configurationBusy}
                            aria-label="Reset configuration"
                            className="hover:text-destructive focus-visible:text-destructive"
                          >
                            <RotateCcw className="size-3.5" />
                          </IconButton>
                        )}
                      />
                    </div>
                  </SettingsRow>
                  {configurationStatus ? (
                    <div className="px-1.5 text-right text-[length:var(--ui-fs-axis)] text-muted-foreground/70">
                      {configurationStatus}
                    </div>
                  ) : null}
                </SettingsSection>

                <SettingsDivider />

                {/* Feedback */}
                <SettingsSection>
                  <SettingsRow label="Feedback">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setFeedbackOpen(true)}
                      aria-label="Send feedback"
                      className="h-7 px-2 text-[length:var(--ui-fs-display)]"
                    >
                      Send Feedback
                    </Button>
                  </SettingsRow>
                </SettingsSection>
                {feedbackOpen
                  ? createPortal(
                      <FeedbackDialog onClose={() => setFeedbackOpen(false)} />,
                      document.body
                    )
                  : null}

                {/* Footer */}
                {appVersion ? (
                  <>
                    <SettingsDivider />
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-1.5 text-[length:var(--ui-fs-metric-meta)]">
                      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
                        <span className="shrink-0 font-mono tabular-nums text-muted-foreground/60">
                          v{appVersion}
                        </span>
                        <span className="shrink-0 text-muted-foreground/30">/</span>
                        <span
                          className={cn(
                            "min-w-0 truncate",
                            hasUpdate ? "text-primary" : "text-muted-foreground/60"
                          )}
                        >
                          {updateStatusText}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                        <button
                          type="button"
                          className={FOOTER_LINK_CLASS}
                          disabled={updateCheckDisabled}
                          onClick={onCheckForUpdate}
                        >
                          Check
                        </button>
                        <button
                          type="button"
                          className={cn(
                            FOOTER_LINK_CLASS,
                            hasUpdate && "text-primary hover:text-primary"
                          )}
                          onClick={() => openReleaseUrl(effectiveReleaseUrl)}
                        >
                          Releases
                          <ExternalLink className="size-3" />
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
    </Sheet>
  );
}
