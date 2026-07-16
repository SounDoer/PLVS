import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SELECT_TRIGGER_CLASS =
  "h-6 w-auto shrink-0 rounded-md border border-transparent bg-transparent px-2 py-0 text-[length:var(--ui-fs-control)] text-popover-foreground shadow-none outline-none transition-colors hover:border-border hover:bg-secondary/85 focus:ring-0 focus:ring-offset-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0";

const SELECT_CONTENT_CLASS =
  "border-border/50 min-w-[var(--radix-select-trigger-width)] [&_[data-slot=select-item]]:py-1 [&_[data-slot=select-item]]:pr-6 [&_[data-slot=select-item]]:pl-2 [&_[data-slot=select-item]]:text-[length:var(--ui-fs-control)] [&_[data-slot=select-item]]:hover:bg-secondary/85";

const SWITCH_CLASS =
  "h-4 w-7 border border-border/40 bg-secondary/85 transition-colors hover:border-border/70 hover:bg-muted-foreground/30 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:hover:border-primary data-[state=checked]:hover:bg-primary data-[state=unchecked]:bg-secondary/85 data-[state=unchecked]:hover:bg-muted-foreground/30 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0";

const SWITCH_THUMB_CLASS =
  "size-3 bg-popover-foreground/80 shadow-none data-[state=checked]:translate-x-3 data-[state=checked]:bg-background/95 data-[state=unchecked]:translate-x-0";

const ROW_LABEL_CLASS = "text-[length:var(--ui-fs-control)] font-medium text-muted-foreground";

export function CloseConfirmDialog({ open, onConfirm, onCancel }) {
  const [action, setAction] = useState("quit");
  const [dontAsk, setDontAsk] = useState(false);

  function handleConfirm() {
    const a = action;
    const d = dontAsk;
    setAction("quit");
    setDontAsk(false);
    onConfirm(a, d);
  }

  function handleCancel() {
    setAction("quit");
    setDontAsk(false);
    onCancel();
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) handleCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 inline-flex -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-card p-3 shadow-xl focus:outline-none">
          <Dialog.Title className="sr-only">Close PLVS</Dialog.Title>
          <div className="mb-1.5 flex min-h-6 items-center justify-between gap-4 rounded-md px-1.5 py-0.5">
            <span className={ROW_LABEL_CLASS}>Close Behavior</span>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger aria-label="Close behavior" className={SELECT_TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className={SELECT_CONTENT_CLASS}>
                <SelectItem value="tray">Minimize to Tray</SelectItem>
                <SelectItem value="quit">Quit</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mb-3 flex min-h-6 items-center justify-between gap-4 rounded-md px-1.5 py-0.5">
            <span className={ROW_LABEL_CLASS}>Don&apos;t ask again</span>
            <Switch
              aria-label="Don't ask again"
              checked={dontAsk}
              onCheckedChange={setDontAsk}
              className={SWITCH_CLASS}
              thumbClassName={SWITCH_THUMB_CLASS}
            />
          </div>

          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md px-2 py-0.5 text-[length:var(--ui-fs-control)] text-muted-foreground transition-colors hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded-md bg-primary px-2 py-0.5 text-[length:var(--ui-fs-control)] text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Confirm
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
