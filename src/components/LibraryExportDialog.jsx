import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { ItemPickerDialog } from "./ItemPickerDialog.jsx";
import { MenuRow } from "@/components/ui/row";

const LIBRARY_TYPES = [
  { type: "loudness", label: "Loudness Profiles" },
  { type: "presets", label: "Presets" },
  { type: "themes", label: "Themes" },
];

/**
 * @param {number} count
 */
function itemCountLabel(count) {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

/**
 * Chooses one Library kind, then delegates its item selection to the existing picker.
 * @param {{
 *   open: boolean,
 *   itemsByType?: any,
 *   dependenciesByType?: any,
 *   onExport?: (...args: any[]) => any,
 *   onClose?: (...args: any[]) => any,
 * }} props
 */
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
    <Dialog open={open} onOpenChange={(next) => (next ? null : close())}>
      <DialogContent overlayProps={{ onClick: close }}>
        <DialogTitle>Export Saved Items</DialogTitle>
        <DialogDescription>Choose a type, then select the items to export.</DialogDescription>

        <div className="my-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {LIBRARY_TYPES.map(({ type, label }) => {
            const count = itemsByType[type]?.length ?? 0;
            return (
              <MenuRow
                key={type}
                disabled={count === 0}
                onClick={() => setSelectedType(type)}
                className="justify-between gap-3 px-2 disabled:pointer-events-none disabled:opacity-40"
              >
                <span>{label}</span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  {itemCountLabel(count)}
                  <ChevronRight className="size-[1.15em] shrink-0" aria-hidden="true" />
                </span>
              </MenuRow>
            );
          })}
        </div>

        <DialogFooter divided>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
