import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
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
  uiMode,
  setUiMode,
  referenceProfileId,
  setReferenceProfileId,
  loudnessReferenceProfiles,
  channelLayout,
  setChannelLayout,
  /** @type {{ key: string; label: string; x: number; y: number }[]} */
  vectorscopePairOptions = [],
  vectorscopePairX = 0,
  vectorscopePairY = 1,
  onVectorscopePairChange,
  resetLayout,
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
        className={cn(
          "w-full gap-0 overflow-y-auto border-border bg-card/95 p-6 backdrop-blur-md sm:max-w-md",
          "pt-12",
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
              exit={reduceMotion ? { opacity: 1 } : { opacity: 0, x: 14 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 420, damping: 36, mass: 0.35 }
              }
            >
              <SheetHeader className="mb-[var(--ui-settings-header-gap)] space-y-0 p-0 pr-10 text-left">
                <SheetTitle className="text-lg font-semibold tracking-tight">Settings</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-5 text-[length:var(--ui-fs-metric-meta)]">
                <div className="grid gap-2">
                  <Label htmlFor="settings-ref-profile">Loudness reference</Label>
                  <Select value={referenceProfileId} onValueChange={setReferenceProfileId}>
                    <SelectTrigger id="settings-ref-profile">
                      <SelectValue placeholder="Profile" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {(loudnessReferenceProfiles || []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <div className="grid gap-2">
                  <Label htmlFor="settings-theme">Theme</Label>
                  <Select value={uiMode} onValueChange={setUiMode}>
                    <SelectTrigger id="settings-theme">
                      <SelectValue placeholder="Theme" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="system">Follow system</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="shrink-0">Layout</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={resetLayout}
                    className="h-auto shrink-0 py-1 text-[length:var(--ui-fs-metric-meta)]"
                  >
                    Reset Layout
                  </Button>
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
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <div className="grid gap-2">
                  <Label htmlFor="settings-vs-pair">Vectorscope channels</Label>
                  {vectorscopePairOptions.length > 0 && typeof onVectorscopePairChange === "function" ? (
                    <Select
                      value={vectorscopePairOptions.some((o) => o.key === vsKey) ? vsKey : vectorscopePairOptions[0]?.key}
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
                    <p className="text-muted-foreground text-sm">At least 2 channels (start monitoring)</p>
                  )}
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </SheetContent>
    </Sheet>
  );
}
