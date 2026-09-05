import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { SCRIM_CLASS } from "@/components/ui/surfaceStyles.js";
import { parseSelection } from "../lib/loudnessProfileCatalog.js";
import { PACK_KINDS } from "../transfer/packShape.js";

const EMPTY_MESSAGE = {
  loudness: "No loudness profiles to export.",
  presets: "No presets to export.",
  themes: "No custom themes to export.",
};

const DISPOSITION_LABEL = {
  added: "Add",
  skipped: "Already in your library",
  duplicated: "Import as a copy",
};

function PlanRow({ entry }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1 text-[length:var(--ui-fs-control)]">
      <span className="truncate">{entry.name}</span>
      <span className="shrink-0 text-muted-foreground">{DISPOSITION_LABEL[entry.disposition]}</span>
    </li>
  );
}

/// One dialog, two directions. `pick` chooses library items to write to a file; `review` shows what
/// a parsed file would do before anything is written.
///
/// Deliberately NOT registered with `useBlockingEditor`: it holds selection state, not a draft, so
/// closing it discards nothing the user authored, and neither mode performs a scene operation.
/// Registering it would block preset apply and dock entry for no reason.
///
/// Position is not persisted -- unlike `ThemeEditor`, which stays open across repeated adjustments,
/// this dialog is a one-shot pick-or-review-then-close, so it always opens centred and is not
/// draggable.
export function ItemPickerDialog({
  open,
  mode,
  type,
  items = [],
  dependencies = [],
  review = null,
  onExport = () => {},
  onConfirm = () => {},
  onClose = () => {},
}) {
  const [selected, setSelected] = useState(() => new Set());
  const label = PACK_KINDS[type].label;
  const title = mode === "pick" ? `Export ${label}` : `Import ${label}`;

  useEffect(() => {
    if (!open) setSelected(new Set());
  }, [open]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Which bundled profiles the current selection drags along. Derived from the checked presets
  // rather than passed in, so the caller hands over the plain profile library and nothing has to
  // stay in sync with the checkboxes.
  const neededProfileIds = new Set(
    type === "presets"
      ? items
          .filter((item) => selected.has(item.id))
          .map((item) => parseSelection(item.loudnessProfileActive))
          .filter((selection) => selection.kind === "profile")
          .map((selection) => selection.id)
      : []
  );
  const shownDependencies = dependencies.filter((dep) => neededProfileIds.has(dep.id));
  const profilePlan = review?.profilePlan ?? [];

  function handleDismiss() {
    onClose();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? null : handleDismiss())}>
      <Dialog.Portal>
        <Dialog.Overlay className={SCRIM_CLASS} onClick={handleDismiss} />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card p-3 text-card-foreground shadow-xl">
          <Dialog.Title className="text-[length:var(--ui-fs-control)] font-semibold text-foreground">
            {title}
          </Dialog.Title>
          <Dialog.Description className="mt-0.5 text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
            {mode === "pick"
              ? `Choose which ${label.toLowerCase()} to export.`
              : `Review what will be added to your library.`}
          </Dialog.Description>

          <div className="my-3 min-h-0 flex-1 overflow-y-auto">
            {mode === "pick" ? (
              items.length === 0 ? (
                <p className="text-[length:var(--ui-fs-control)] text-muted-foreground">
                  {EMPTY_MESSAGE[type]}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {items.map((item) => (
                    <li key={item.id}>
                      <label className="flex items-center gap-2 rounded-md px-1 py-1 text-[length:var(--ui-fs-control)] hover:bg-muted/50">
                        <input
                          type="checkbox"
                          aria-label={item.name}
                          checked={selected.has(item.id)}
                          onChange={() => toggle(item.id)}
                        />
                        <span className="truncate">{item.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <ul className="flex flex-col gap-0.5">
                {(review?.itemPlan ?? []).map((entry) => (
                  <PlanRow key={entry.sourceId} entry={entry} />
                ))}
              </ul>
            )}

            {mode === "pick" && shownDependencies.length > 0 ? (
              <section className="mt-3 border-t border-border pt-2">
                <h3 className="text-[length:var(--ui-fs-metric-meta)] font-semibold text-muted-foreground">
                  Also included
                </h3>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {shownDependencies.map((dep) => (
                    <li key={dep.id} className="text-[length:var(--ui-fs-control)]">
                      {dep.name}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {mode === "review" && profilePlan.length > 0 ? (
              <section className="mt-3 border-t border-border pt-2">
                <h3 className="text-[length:var(--ui-fs-metric-meta)] font-semibold text-muted-foreground">
                  Also included
                </h3>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {profilePlan.map((entry) => (
                    <PlanRow key={entry.sourceId} entry={entry} />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-2">
            <Button variant="ghost" onClick={handleDismiss}>
              Cancel
            </Button>
            {mode === "pick" ? (
              <Button disabled={selected.size === 0} onClick={() => onExport([...selected])}>
                Export
              </Button>
            ) : (
              <Button onClick={onConfirm}>Import</Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
