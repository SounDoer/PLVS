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
  appVersion,
}) {
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
                  <Label htmlFor="settings-channel-layout">Channel layout</Label>
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
