import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

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
  /** @type {{ key: string; label: string; x: number; y: number }[]} */
  vectorscopePairOptions = [],
  vectorscopePairX = 0,
  vectorscopePairY = 1,
  onVectorscopePairChange,
  /** @type {import("../math/spectrumChannelOptions.js").SpectrumChannelOption[]} */
  spectrumChannelOptions = [],
  spectrumChannelSel = null,
  onSpectrumChannelChange,
  appVersion,
}) {
  const vsKey = `${vectorscopePairX}-${vectorscopePairY}`;
  const reduceMotion = useReducedMotion();
  const [sheetBodyVisible, setSheetBodyVisible] = useState(settingsOpen);
  const closingIntentRef = useRef(false);

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
              <SheetHeader className="mb-[var(--ui-modal-header-gap)] space-y-0 p-0 pr-10 text-left">
                <SheetTitle className="text-[length:var(--ui-fs-panel-title)] font-semibold text-muted-foreground">
                  Settings
                </SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-5 text-[length:var(--ui-fs-metric-meta)]">
                <div className="grid gap-2">
                  <Label htmlFor="settings-appearance">Appearance</Label>
                  <Select value={appearance} onValueChange={setAppearanceMode}>
                    <SelectTrigger id="settings-appearance">
                      <SelectValue placeholder="Appearance" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="system">Follow system</SelectItem>
                      <SelectItem value="fixed">Fixed theme</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {appearance === "fixed" ? (
                  <div className="grid gap-2">
                    <Label htmlFor="settings-theme-id">Colour theme</Label>
                    <Select value={fixedThemeSelectValue} onValueChange={setFixedThemeIdFromPicker}>
                      <SelectTrigger id="settings-theme-id">
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
                <div className="grid gap-2">
                  <Label htmlFor="settings-ref-lufs">Loudness reference</Label>
                  <div className="flex items-center gap-2">
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
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-[length:var(--ui-fs-metric-meta)] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <span className="text-muted-foreground shrink-0">LUFS</span>
                  </div>
                </div>
                <Separator />
                <div className="grid gap-2">
                  <Label htmlFor="settings-channel-layout">Channel layout (Advanced)</Label>
                  <Select value={channelLayout} onValueChange={setChannelLayout}>
                    <SelectTrigger id="settings-channel-layout">
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
                <Separator />
                <div className="grid gap-2">
                  <Label htmlFor="settings-vs-pair">Vectorscope channels</Label>
                  {vectorscopePairOptions.length > 0 &&
                  typeof onVectorscopePairChange === "function" ? (
                    <Select
                      value={
                        vectorscopePairOptions.some((o) => o.key === vsKey)
                          ? vsKey
                          : vectorscopePairOptions[0]?.key
                      }
                      onValueChange={(key) => {
                        const [xRaw, yRaw] = String(key).split("-");
                        const x = Number.parseInt(xRaw || "0", 10);
                        const y = Number.parseInt(yRaw || "1", 10);
                        onVectorscopePairChange({
                          x: Number.isFinite(x) ? x : 0,
                          y: Number.isFinite(y) ? y : 1,
                        });
                      }}
                    >
                      <SelectTrigger id="settings-vs-pair">
                        <SelectValue placeholder="Pair" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {vectorscopePairOptions.map((o) => (
                          <SelectItem key={o.key} value={o.key}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      At least 2 channels (start monitoring)
                    </p>
                  )}
                </div>
                {spectrumChannelOptions.length > 1 &&
                  typeof onSpectrumChannelChange === "function" && (
                    <>
                      <Separator />
                      <div className="grid gap-2">
                        <Label htmlFor="settings-spectrum-channel">Spectrum channel</Label>
                        <Select
                          value={(() => {
                            if (!spectrumChannelSel) return spectrumChannelOptions[0]?.key ?? "";
                            const key =
                              spectrumChannelSel.type === "pair"
                                ? `p-${spectrumChannelSel.x}-${spectrumChannelSel.y}`
                                : `s-${spectrumChannelSel.ch}`;
                            return spectrumChannelOptions.some((o) => o.key === key)
                              ? key
                              : (spectrumChannelOptions[0]?.key ?? "");
                          })()}
                          onValueChange={(key) => {
                            const opt = spectrumChannelOptions.find((o) => o.key === key);
                            if (opt) onSpectrumChannelChange(opt.sel);
                          }}
                        >
                          <SelectTrigger id="settings-spectrum-channel">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent position="popper">
                            {spectrumChannelOptions.map((o) => (
                              <SelectItem key={o.key} value={o.key}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}
                {appVersion ? (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Version</span>
                      <span className="font-mono tabular-nums">{appVersion}</span>
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
