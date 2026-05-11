import { Button } from "@/components/ui/button";
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
  return (
    <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
      <SheetContent
        side="right"
        className={cn(
          "w-full gap-0 overflow-y-auto border-border bg-card/95 p-6 backdrop-blur-md sm:max-w-md",
          "pt-12",
        )}
      >
        <SheetHeader className="mb-[var(--ui-settings-header-gap)] space-y-0 p-0 pr-10 text-left">
          <SheetTitle className="ui-settings-heading">Settings</SheetTitle>
        </SheetHeader>
        <div className="ui-settings-content flex flex-col text-[length:var(--ui-fs-metric-meta)]">
          <div className="ui-settings-row">
            <span className="ui-settings-label">Loudness reference</span>
            <select
              value={referenceProfileId}
              onChange={(e) => setReferenceProfileId(e.target.value)}
              className="ui-select"
            >
              {(loudnessReferenceProfiles || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-settings-row">
            <span className="ui-settings-label">Theme</span>
            <select value={uiMode} onChange={(e) => setUiMode(e.target.value)} className="ui-select">
              <option value="system">Follow system</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
          <div className="ui-settings-row">
            <span className="ui-settings-label">Layout</span>
            <Button type="button" variant="outline" size="sm" onClick={resetLayout} className="h-auto shrink-0 py-1 text-[length:var(--ui-fs-metric-meta)]">
              Reset Layout
            </Button>
          </div>
          <div className="ui-settings-row">
            <span className="ui-settings-label">Channel layout (Advanced)</span>
            <select value={channelLayout} onChange={(e) => setChannelLayout(e.target.value)} className="ui-select">
              <option value="auto">Auto</option>
              <option value="stereo">Stereo</option>
              <option value="5.1">5.1</option>
            </select>
          </div>
          <div className="ui-settings-row">
            <span className="ui-settings-label">Vectorscope Channels</span>
            {vectorscopePairOptions.length > 0 && typeof onVectorscopePairChange === "function" ? (
              <select
                className="ui-select"
                value={vectorscopePairOptions.some((o) => o.key === vsKey) ? vsKey : vectorscopePairOptions[0]?.key}
                onChange={(e) => {
                  const [xRaw, yRaw] = String(e.target.value).split("-");
                  const x = Number.parseInt(xRaw || "0", 10);
                  const y = Number.parseInt(yRaw || "1", 10);
                  onVectorscopePairChange({
                    x: Number.isFinite(x) ? x : 0,
                    y: Number.isFinite(y) ? y : 1,
                  });
                }}
              >
                {vectorscopePairOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[color:var(--ui-color-text-muted)]">At least 2 channels (start monitoring)</span>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
