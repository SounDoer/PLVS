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
import {
  establishDevelopmentLibraryConflict,
  matchesDevelopmentLibraryConflict,
  resetDevelopmentLibraryConflict,
  resolveLibraryConflict,
  subscribeLibraryConflicts,
} from "../persistence/index.js";
import { useDevelopmentEventFixtureAdapter } from "../dev/DevelopmentEventFixturesContext.jsx";
import { DEVELOPMENT_LIBRARY_CONFLICT } from "../dev/developmentEventFixtureData.js";
import { useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";
import { useBlockingEditor } from "../hooks/BlockingEditorsContext.jsx";

const LABELS = {
  preset: "Preset",
  theme: "Theme",
  loudnessProfile: "Loudness Profile",
};

export function LibraryConflictDialog() {
  const [conflict, setConflict] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useBlockingEditor("libraryConflict", conflict !== null);

  useEffect(() => subscribeLibraryConflicts(setConflict), []);
  useDevelopmentEventFixtureAdapter("library-conflict.pending", {
    establish: (fixtureId) =>
      establishDevelopmentLibraryConflict(fixtureId, DEVELOPMENT_LIBRARY_CONFLICT),
    reset: resetDevelopmentLibraryConflict,
    matches: matchesDevelopmentLibraryConflict,
    canReset: () => !busy,
    surface: { kind: "libraryConflict", target: { phase: "decision" } },
  });

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
  const deleting = conflict?.operation === "delete";
  const collection = conflict?.operation === "collection";
  const reloadOnly = deleting || collection;
  let description =
    "Another PLVS workbench saved this item first. Reload its saved version, or keep your version as a new copy.";
  if (deleting) {
    description =
      "The saved item changed while you were deleting it. Reload the Library before trying again.";
  } else if (collection) {
    description =
      "Another PLVS workbench changed this list first. Reload to get its order and save your compatible edits. If an item also conflicts, you can keep your version as a copy.";
  }
  useUiSurface({
    active: conflict !== null,
    kind: "libraryConflict",
    origin: "event",
    developmentFixture: "library-conflict.pending",
    blocking: true,
    busy,
    dismissible: false,
    supportedActions: [],
    choices: [
      { id: "reload", label: "Reload", run: () => resolve("reload") },
      { id: "copy", label: "Save as Copy", run: () => resolve("copy"), disabled: reloadOnly },
    ],
    target: { phase: error ? "error" : busy ? "busy" : "decision" },
  });
  return (
    <Dialog open={conflict !== null}>
      <DialogContent layer={LAYER_CONFLICT}>
        <DialogTitle>
          {label}
          {collection ? " List" : ""} Changed Elsewhere
        </DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {error ? (
          <p className="mt-2 text-[length:var(--ui-fs-control)] text-destructive">{error}</p>
        ) : null}
        <DialogFooter className="mt-3">
          <Button variant="ghost" disabled={busy} onClick={() => void resolve("reload")}>
            Reload
          </Button>
          {reloadOnly ? null : (
            <Button disabled={busy} onClick={() => void resolve("copy")}>
              Save as Copy
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
