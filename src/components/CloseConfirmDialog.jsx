import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";

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
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl focus:outline-none">
          <Dialog.Title className="mb-5 text-sm font-semibold text-foreground">
            Close PLVS
          </Dialog.Title>

          <div className="mb-4 space-y-3">
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="radio"
                name="closeAction"
                value="quit"
                checked={action === "quit"}
                onChange={() => setAction("quit")}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">Quit</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="radio"
                name="closeAction"
                value="tray"
                checked={action === "tray"}
                onChange={() => setAction("tray")}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">Minimize to Tray</span>
            </label>
          </div>

          <label className="mb-6 flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={dontAsk}
              onChange={(e) => setDontAsk(e.target.checked)}
              className="accent-primary"
            />
            <span className="text-sm text-muted-foreground">Don&apos;t ask again</span>
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Confirm
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
