import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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

const RELEASES_URL = "https://github.com/SounDoer/PLVS/releases";

export function SettingsPanel({
  settingsOpen,
  setSettingsOpen,
  appearance,
  setAppearanceMode,
  fixedThemeSelectValue,
  setFixedThemeIdFromPicker,
  themeSelectOptions,
  referenceLufs,
  setReferenceLufs,
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
}) {
  const reduceMotion = useReducedMotion();
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac/i.test(navigator.platform || navigator.userAgent || "");
  const [sheetBodyVisible, setSheetBodyVisible] = useState(settingsOpen);
  const closingIntentRef = useRef(false);
  const [refLufsInput, setRefLufsInput] = useState(String(referenceLufs));
  useEffect(() => {
    setRefLufsInput(String(referenceLufs));
  }, [referenceLufs]);
  const commitRefLufs = () => {
    if (refLufsInput.trim() === "") {
      setRefLufsInput(String(referenceLufs));
      return;
    }
    const n = Number(refLufsInput);
    if (Number.isFinite(n) && n >= -70 && n <= 0) {
      setReferenceLufs(n);
    } else {
      setRefLufsInput(String(referenceLufs));
    }
  };
  const effectiveReleaseUrl = releaseUrl || RELEASES_URL;
  const updateCheckDisabled = updateStatus === "checking";
  let updateStatusText = "Checking updates";
  if (updateStatus === "unavailable") {
    updateStatusText = "Update check unavailable";
  } else if (!updateCheckDisabled && latestVersion) {
    updateStatusText = hasUpdate ? `Update available: v${latestVersion}` : "Up to date";
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
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className={cn(
          "w-full gap-0 overflow-y-auto border-border bg-card/95 p-6 backdrop-blur-md sm:max-w-md",
          "pt-12"
        )}
      >
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
              <div className="flex flex-col gap-5 text-[length:var(--ui-fs-metric-meta)]">
                <div className="grid gap-5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="settings-open-at-login">Open at Login</Label>
                    <Switch
                      id="settings-open-at-login"
                      checked={autostartEnabled}
                      onCheckedChange={setAutostartEnabled}
                      disabled={!autostartReady}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="settings-close-action" className="shrink-0">
                      Close Behavior
                    </Label>
                    <Select value={closeAction} onValueChange={setCloseAction}>
                      <SelectTrigger id="settings-close-action" className="w-auto shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="ask">Ask Each Time</SelectItem>
                        <SelectItem value="tray">Minimize to Tray</SelectItem>
                        <SelectItem value="quit">Quit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Separator />
                <div className="grid gap-2">
                  <Label>Keyboard Shortcuts</Label>
                  <div className="grid gap-1.5 text-muted-foreground">
                    {KEYBOARD_SHORTCUTS.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2">
                        <span>{s.label}</span>
                        <span className="font-mono tabular-nums">
                          {formatAcceleratorForDisplay(s.keys, { isMac })}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="settings-clear">Clear</Label>
                      <ShortcutCapture
                        value={clearShortcut}
                        onChange={setClearShortcut}
                        onRecordingChange={setClearCapturing}
                        isMac={isMac}
                        disabled={!clearReady}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <InlineConfirm
                        onConfirm={() => setClearShortcut(DEFAULT_CLEAR_SHORTCUT)}
                        confirmLabel="Confirm reset clear shortcut"
                        cancelLabel="Cancel reset clear shortcut"
                        trigger={(arm) => (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={!clearReady}
                            onClick={arm}
                            aria-label="Reset clear shortcut"
                          >
                            Reset
                          </Button>
                        )}
                      />
                      <Switch
                        id="settings-clear"
                        checked={clearGlobal}
                        onCheckedChange={setClearGlobal}
                        disabled={!clearReady}
                        className={cn(registrationError && "ring-2 ring-destructive")}
                      />
                    </div>
                  </div>
                  {registrationError ? (
                    <span className="text-xs text-destructive">Combo unavailable, try another</span>
                  ) : null}
                </div>
                <Separator />
                <div className="flex flex-col gap-2">
                  {themeControlsDisabled ? (
                    <span className="text-xs text-muted-foreground">
                      Finish editing the current theme before changing theme settings.
                    </span>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="settings-appearance" className="shrink-0">
                      Appearance
                    </Label>
                    <Select
                      value={appearance}
                      onValueChange={setAppearanceMode}
                      disabled={themeControlsDisabled}
                    >
                      <SelectTrigger
                        id="settings-appearance"
                        className="w-auto shrink-0"
                        disabled={themeControlsDisabled}
                      >
                        <SelectValue placeholder="Appearance" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="system">Follow System</SelectItem>
                        <SelectItem value="fixed">Fixed Theme</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {appearance === "fixed" ? (
                  <div className="flex flex-col gap-2">
                    <div
                      role="group"
                      aria-label="Theme picker"
                      className="flex items-center justify-between gap-2"
                    >
                      <Label htmlFor="settings-theme-id" className="shrink-0">
                        Colour Theme
                      </Label>
                      <Select
                        value={fixedThemeSelectValue}
                        onValueChange={setFixedThemeIdFromPicker}
                        disabled={themeControlsDisabled}
                      >
                        <SelectTrigger
                          id="settings-theme-id"
                          className="w-auto shrink-0"
                          disabled={themeControlsDisabled}
                        >
                          <SelectValue placeholder="Theme" />
                        </SelectTrigger>
                        <SelectContent position="popper">
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
                    </div>
                    <div
                      role="group"
                      aria-label="Theme actions"
                      className="flex items-center justify-end gap-2"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={themeControlsDisabled}
                        onClick={createCustomTheme}
                      >
                        Add New Theme
                      </Button>
                      {activeIsCustom ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={themeControlsDisabled}
                            onClick={editActiveCustomTheme}
                          >
                            Edit
                          </Button>
                          <InlineConfirm
                            onConfirm={() => deleteCustomTheme(fixedThemeSelectValue)}
                            confirmLabel="Confirm delete theme"
                            cancelLabel="Cancel delete theme"
                            trigger={(arm) => (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={themeControlsDisabled}
                                className="text-destructive"
                                onClick={arm}
                              >
                                Delete
                              </Button>
                            )}
                          />
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <Separator />
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="settings-ref-lufs" className="shrink-0">
                    Loudness Reference
                  </Label>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      id="settings-ref-lufs"
                      type="number"
                      min={-70}
                      max={0}
                      step={1}
                      value={refLufsInput}
                      onChange={(e) => setRefLufsInput(e.target.value)}
                      onBlur={commitRefLufs}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      className="flex h-9 w-16 rounded-md border border-input bg-transparent px-3 py-1 text-[length:var(--ui-fs-metric-meta)] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <span className="text-muted-foreground shrink-0">LUFS</span>
                  </div>
                </div>
                <Separator />
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="shrink-0">
                      Channel Labels{channelCount > 0 ? ` · ${channelCount}-channel` : ""}
                    </Label>
                    {channelCount > 0 ? (
                      <InlineConfirm
                        onConfirm={resetChannelLabels}
                        confirmLabel="Confirm reset channel labels"
                        cancelLabel="Cancel reset channel labels"
                        trigger={(arm) => (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={arm}
                            disabled={!channelLabelHasOverride}
                            aria-label="Reset channel labels"
                            className="h-auto px-2 py-1 text-xs"
                          >
                            Reset
                          </Button>
                        )}
                      />
                    ) : null}
                  </div>
                  {channelCount > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      {channelLabelTokens.map((token, i) => (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                            {i + 1}
                          </span>
                          <Select value={token} onValueChange={(v) => setChannelLabelToken(i, v)}>
                            <SelectTrigger
                              className="w-auto shrink-0"
                              aria-label={`Channel ${i + 1} role`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper">
                              {CHANNEL_ROLE_VOCABULARY.map((role) => (
                                <SelectItem key={role.id} value={role.id}>
                                  {role.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Connect an input to label its channels.
                    </span>
                  )}
                </div>
                {appVersion ? (
                  <>
                    <Separator />
                    <div className="flex items-center justify-end text-muted-foreground">
                      <div className="flex min-w-0 items-center justify-end gap-1.5 text-xs">
                        <span className="font-mono tabular-nums text-muted-foreground">
                          v{appVersion}
                        </span>
                        <span className="text-muted-foreground/50">·</span>
                        <span className={hasUpdate ? "text-primary" : "text-muted-foreground"}>
                          {updateStatusText}
                        </span>
                        <span className="text-muted-foreground/50">·</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto px-0 py-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground disabled:opacity-60"
                          disabled={updateCheckDisabled}
                          onClick={onCheckForUpdate}
                        >
                          Check Again
                        </Button>
                        <span className="text-muted-foreground/50">·</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-auto gap-1 px-0 py-0 text-xs hover:bg-transparent",
                            hasUpdate
                              ? "text-primary hover:text-primary"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                          onClick={() => openReleaseUrl(effectiveReleaseUrl)}
                        >
                          {hasUpdate ? "View Release" : "View Releases"}
                          <ExternalLink className="size-3" />
                        </Button>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </SheetContent>
    </Sheet>
  );
}
