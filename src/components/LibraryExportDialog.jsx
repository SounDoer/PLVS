import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MODAL_SURFACE_CLASS, SCRIM_CLASS } from "@/components/ui/surfaceStyles.js";
import { ItemPickerDialog } from "./ItemPickerDialog.jsx";

const CONTENT_CLASS = `fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl p-3 ${MODAL_SURFACE_CLASS}`;

const LIBRARY_TYPES = [
  { type: "loudness", label: "Loudness Profiles" },
  { type: "presets", label: "Presets" },
  { type: "themes", label: "Themes" },
];

function itemCountLabel(count) {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

/** Chooses one Library kind, then delegates its item selection to the existing picker. */
export function LibraryExportDialog({
  open,
  itemsByType = {},
  dependenciesByType = {},
  onExport = () => {},
  onClose = () => {},
}) {
  const [selectedType, setSelectedType] = useState(null);

  useEffect(() => {
    if (!open) setSelectedType(null);
  }, [open]);

  function close() {
    setSelectedType(null);
    onClose();
  }

  if (selectedType) {
    return (
      <ItemPickerDialog
        open={open}
        mode="pick"
        type={selectedType}
        items={itemsByType[selectedType] ?? []}
        dependencies={dependenciesByType[selectedType] ?? []}
        onExport={async (ids) => {
          const outcome = await onExport(selectedType, ids);
          if (outcome !== "cancelled") close();
        }}
        onBack={() => setSelectedType(null)}
        onClose={close}
      />
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? null : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className={SCRIM_CLASS} onClick={close} />
        <Dialog.Content className={CONTENT_CLASS}>
          <Dialog.Title className="text-[length:var(--ui-fs-control)] font-semibold text-foreground">
            Export Saved Items
          </Dialog.Title>
          <Dialog.Description className="mt-0.5 text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
            Choose a type, then select the items to export.
          </Dialog.Description>

          <div className="my-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {LIBRARY_TYPES.map(({ type, label }) => {
              const count = itemsByType[type]?.length ?? 0;
              return (
                <button
                  key={type}
                  type="button"
                  disabled={count === 0}
                  onClick={() => setSelectedType(type)}
                  className="flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[length:var(--ui-fs-control)] transition-colors hover:bg-ui-hover disabled:pointer-events-none disabled:opacity-40"
                >
                  <span>{label}</span>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    {itemCountLabel(count)}
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex justify-end border-t border-border pt-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
