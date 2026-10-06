import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "./ui/dialog.jsx";
import { Button } from "./ui/button.jsx";
import { LAYER_CONFLICT } from "./ui/layers.js";
import { resolveLibraryConflict, subscribeLibraryConflicts } from "../persistence/index.js";
import { useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";

const LABELS = {
  preset: "Preset",
  theme: "Theme",
  loudnessProfile: "Loudness Profile",
};

export function LibraryConflictDialog() {
  const [conflict, setConflict] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => subscribeLibraryConflicts(setConflict), []);

  /**
   * @param {string} action
   */
  async function resolve(action) {
    setBusy(true);
    setError(null);
    try {
      await resolveLibraryConflict(action);
    } catch (reason) {
      setError(reason?.message || String(reason));
    } finally {
      setBusy(false);
    }
  }

  const label = LABELS[conflict?.kind] || "Library item";
  useUiSurface({
    active: conflict !== null,
    kind: "libraryConflict",
    origin: "event",
    blocking: true,
    busy,
    dismissible: false,
    supportedActions: [],
    target: { phase: error ? "error" : busy ? "busy" : "decision" },
  });
  return (
    <Dialog open={conflict !== null}>
      <DialogContent layer={LAYER_CONFLICT}>
        <DialogTitle>{label} Changed Elsewhere</DialogTitle>
        <DialogDescription>
          Another PLVS workbench saved this item first. Reload its saved version, or keep your
          version as a new copy.
        </DialogDescription>
        {error ? (
          <p className="mt-2 text-[length:var(--ui-fs-control)] text-destructive">{error}</p>
        ) : null}
        <DialogFooter className="mt-3">
          <Button variant="ghost" disabled={busy} onClick={() => void resolve("reload")}>
            Reload
          </Button>
          <Button disabled={busy} onClick={() => void resolve("copy")}>
            Save as Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
