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
import { CHANNEL_ROLE_VOCABULARY } from "@/math/channelRoles.js";

const RELEASES_URL = "https://github.com/SounDoer/PLVS/releases";
const DEFAULT_PRESETS = {
  list: [],
  activeId: null,
  save: () => {},
  apply: () => {},
  update: () => {},
  rename: () => {},
  remove: () => {},
};

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
  presets = DEFAULT_PRESETS,
}) {
  const reduceMotion = useReducedMotion();
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac/i.test(navigator.platform || navigator.userAgent || "");
  const [sheetBodyVisible, setSheetBodyVisible] = useState(settingsOpen);
  const [presetName, setPresetName] = useState("");
  const [editingPresetId, setEditingPresetId] = useState(null);
  const [presetRenameDrafts, setPresetRenameDrafts] = useState({});
  const closingIntentRef = useRef(false);
  const presetControls = { ...DEFAULT_PRESETS, ...presets };
  const presetList = Array.isArray(presetControls.list)
    ? presetControls.list
    : DEFAULT_PRESETS.list;
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

  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const result = presetControls.save(name);
    if (result && typeof result.then === "function") {
      result.then((value) => {
        if (value !== false) setPresetName("");
      });
      return;
    }
    if (result !== false) setPresetName("");
  };

  const startRenamePreset = (preset) => {
    setEditingPresetId(preset.id);
    setPresetRenameDrafts((current) => ({ ...current, [preset.id]: preset.name ?? "" }));
  };

  const cancelRenamePreset = (preset) => {
    setEditingPresetId(null);
    setPresetRenameDrafts((current) => ({ ...current, [preset.id]: preset.name ?? "" }));
  };

  const handleRenamePreset = (id) => {
    const name = (presetRenameDrafts[id] ?? "").trim();
    if (!name) return;
    const result = presetControls.rename(id, name);
    if (result !== false) setEditingPresetId(null);
  };

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
                <div className="grid gap-2">
                  <Label htmlFor="settings-preset-name">Presets</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="settings-preset-name"
                      type="text"
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSavePreset();
                      }}
                      placeholder="New preset name"
                      className="flex h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-[length:var(--ui-fs-metric-meta)] shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleSavePreset}
                      disabled={!presetName.trim()}
                    >
                      Save
                    </Button>
                  </div>
                  {presetList.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No presets saved yet.</span>
                  ) : (
                    <div className="grid gap-1.5">
                      {presetList.map((preset) => {
                        const isActive = preset.id === presetControls.activeId;
                        const isEditing = preset.id === editingPresetId;
                        return (
                          <div
                            key={preset.id}
                            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border/70 px-2 py-2"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                aria-label={isActive ? `Active preset ${preset.name}` : undefined}
                                title={isActive ? "Active preset" : undefined}
                                className={cn(
                                  "size-2 shrink-0 rounded-full",
                                  isActive ? "bg-primary" : "bg-muted-foreground/20"
                                )}
                              />
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={presetRenameDrafts[preset.id] ?? preset.name ?? ""}
                                  aria-label={`Rename preset ${preset.name}`}
                                  onChange={(e) =>
                                    setPresetRenameDrafts((current) => ({
                                      ...current,
                                      [preset.id]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleRenamePreset(preset.id);
                                    if (e.key === "Escape") cancelRenamePreset(preset);
                                  }}
                                  className="flex h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-[length:var(--ui-fs-metric-meta)] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                />
                              ) : (
                                <span className="min-w-0 flex-1 truncate text-foreground">
                                  {preset.name}
                                </span>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center justify-end gap-1.5">
                              {isEditing ? (
                                <>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-auto px-2 py-1 text-xs"
                                    onClick={() => handleRenamePreset(preset.id)}
                                    disabled={!(presetRenameDrafts[preset.id] ?? "").trim()}
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-auto px-2 py-1 text-xs"
                                    onClick={() => cancelRenamePreset(preset)}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-auto px-1.5 py-1 text-xs"
                                    onClick={() => presetControls.apply(preset.id)}
                                  >
                                    Apply
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-auto px-1.5 py-1 text-xs"
                                    onClick={() => presetControls.update(preset.id)}
                                  >
                                    Update
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-auto px-1.5 py-1 text-xs"
                                    onClick={() => startRenamePreset(preset)}
                                  >
                                    Rename
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-auto px-1.5 py-1 text-xs text-destructive hover:text-destructive"
                                    onClick={() => presetControls.remove(preset.id)}
                                  >
                                    Delete
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
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
                      <SelectItem value="system">Follow System</SelectItem>
                      <SelectItem value="fixed">Fixed Theme</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {appearance === "fixed" ? (
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="settings-theme-id" className="shrink-0">
                      Colour Theme
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
                    Loudness Reference
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
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="shrink-0">
                      Channel Labels{channelCount > 0 ? ` · ${channelCount}-channel` : ""}
                    </Label>
                    {channelCount > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={resetChannelLabels}
                        disabled={!channelLabelHasOverride}
                        className="h-auto px-2 py-1 text-xs"
                      >
                        Reset to Auto
                      </Button>
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
