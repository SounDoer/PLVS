import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { SCRIM_CLASS } from "./ui/surfaceStyles.js";
import { cn } from "../lib/utils.js";
import { resolveLibraryConflict, subscribeLibraryConflicts } from "../persistence/index.js";

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
  return (
    <Dialog.Root open={conflict !== null}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(SCRIM_CLASS, "z-[90]")} />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[91] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-4 shadow-xl">
          <Dialog.Title className="font-semibold">{label} Changed Elsewhere</Dialog.Title>
          <Dialog.Description className="mt-2 text-[length:var(--ui-fs-control)] text-muted-foreground">
            Another PLVS workbench saved this item first. Reload its saved version, or keep your
            version as a new copy.
          </Dialog.Description>
          {error ? (
            <p className="mt-2 text-[length:var(--ui-fs-control)] text-destructive">{error}</p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => void resolve("reload")}>
              Reload
            </button>
            <button type="button" disabled={busy} onClick={() => void resolve("copy")}>
              Save as Copy
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
