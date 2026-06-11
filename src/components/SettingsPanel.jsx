import { useLayoutEffect, useRef, useState } from "react";
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
import { ShortcutCapture } from "./ShortcutCapture.jsx";
import { KEYBOARD_SHORTCUTS } from "@/data/keyboardShortcuts.js";
import { formatAcceleratorForDisplay } from "@/lib/accelerator.js";
import { DEFAULT_CLEAR_SHORTCUT } from "@/lib/clearShortcutPrefs.js";

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
  channelLayout,
  setChannelLayout,
  appVersion,
  latestVersion,
  releaseUrl,
  hasUpdate = false,
  updateStatus = latestVersion ? "ok" : "checking",
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
  clearReady = false,
  registrationError = null,
}) {
  const reduceMotion = useReducedMotion();
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac/i.test(navigator.platform || navigator.userAgent || "");
  const [sheetBodyVisible, setSheetBodyVisible] = useState(settingsOpen);
  const closingIntentRef = useRef(false);
  const effectiveReleaseUrl = releaseUrl || RELEASES_URL;
  const updateStatusText = latestVersion
    ? hasUpdate
      ? `Update available: v${latestVersion}`
      : "Up to date"
    : updateStatus === "unavailable"
      ? "Update check unavailable"
      : "Checking updates";

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
                    <Label htmlFor="settings-open-at-login">Open at login</Label>
                    <Switch
                      id="settings-open-at-login"
                      checked={autostartEnabled}
                      onCheckedChange={setAutostartEnabled}
                      disabled={!autostartReady}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="settings-close-action" className="shrink-0">
                      Close behavior
                    </Label>
                    <Select value={closeAction} onValueChange={setCloseAction}>
                      <SelectTrigger id="settings-close-action" className="w-auto shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="ask">Ask each time</SelectItem>
                        <SelectItem value="tray">Minimize to tray</SelectItem>
                        <SelectItem value="quit">Quit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Separator />
                <div className="grid gap-2">
                  <Label>Keyboard shortcuts</Label>
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
                        isMac={isMac}
                        disabled={!clearReady}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!clearReady}
                        onClick={() => setClearShortcut(DEFAULT_CLEAR_SHORTCUT)}
                      >
                        Reset
                      </Button>
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
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="settings-appearance" className="shrink-0">
                    Appearance
                  </Label>
                  <Select value={appearance} onValueChange={setAppearanceMode}>
                    <SelectTrigger id="settings-appearance" className="w-auto shrink-0">
                      <SelectValue placeholder="Appearance" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="system">Follow system</SelectItem>
                      <SelectItem value="fixed">Fixed theme</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {appearance === "fixed" ? (
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="settings-theme-id" className="shrink-0">
                      Colour theme
                    </Label>
                    <Select value={fixedThemeSelectValue} onValueChange={setFixedThemeIdFromPicker}>
                      <SelectTrigger id="settings-theme-id" className="w-auto shrink-0">
                        <SelectValue placeholder="Theme" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {themeSelectOptions.map((opt) => (
                          <SelectItem key={opt.id} value={opt.id}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <Separator />
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="settings-ref-lufs" className="shrink-0">
                    Loudness reference
                  </Label>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      id="settings-ref-lufs"
                      type="number"
                      min={-70}
                      max={0}
                      step={1}
                      value={referenceLufs}
                      onChange={(e) => {
                        if (e.target.value === "") return;
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n >= -70 && n <= 0) setReferenceLufs(n);
                      }}
                      className="flex h-9 w-16 rounded-md border border-input bg-transparent px-3 py-1 text-[length:var(--ui-fs-metric-meta)] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <span className="text-muted-foreground shrink-0">LUFS</span>
                  </div>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="settings-channel-layout" className="shrink-0">
                    Channel layout
                  </Label>
                  <Select value={channelLayout} onValueChange={setChannelLayout}>
                    <SelectTrigger id="settings-channel-layout" className="w-auto shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="stereo">Stereo</SelectItem>
                      <SelectItem value="5.1">5.1</SelectItem>
                      <SelectItem value="7.1">7.1</SelectItem>
                    </SelectContent>
                  </Select>
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
                          className={cn(
                            "h-auto gap-1 px-0 py-0 text-xs hover:bg-transparent",
                            hasUpdate
                              ? "text-primary hover:text-primary"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                          onClick={() => openReleaseUrl(effectiveReleaseUrl)}
                        >
                          {hasUpdate ? "View release" : "View releases"}
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
