import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";

const ROW_LABEL_CLASS = "text-[length:var(--ui-fs-control)] font-medium text-muted-foreground";

/**
 * @param {{
 *   open: boolean,
 *   error?: any,
 *   busy?: boolean,
 *   onConfirm: (...args: any[]) => any,
 *   onRetry: (...args: any[]) => any,
 *   onCancel: (...args: any[]) => any,
 * }} props
 */
export function CloseConfirmDialog({
  open,
  error = null,
  busy = false,
  onConfirm,
  onRetry,
  onCancel,
}) {
  const [action, setAction] = useState("quit");
  const [dontAsk, setDontAsk] = useState(false);
  const actionLabel = action === "tray" ? "Minimize to Tray" : "Quit";

  function handleConfirm() {
    const a = action;
    const d = dontAsk;
    setAction("quit");
    setDontAsk(false);
    return onConfirm(a, d);
  }

  function handleCancel() {
    setAction("quit");
    setDontAsk(false);
    onCancel();
  }

  useUiSurface({
    active: open,
    kind: "closeConfirmation",
    origin: "event",
    developmentFixture: "close-confirmation.requested",
    blocking: true,
    busy,
    dismissible: !busy,
    supportedActions: busy ? [] : ["cancel"],
    target: { phase: error ? "error" : "decision", intent: error ? undefined : action },
    generationKey: dontAsk,
    choices: [
      { id: "cancel", label: "Cancel", run: handleCancel },
      error
        ? { id: "retry", label: "Retry", run: onRetry, afterDelivery: true }
        : { id: "confirm", label: actionLabel, run: handleConfirm, afterDelivery: true },
    ],
    onCancel: handleCancel,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleCancel();
      }}
    >
      <DialogContent size="sm" className="overflow-y-auto" aria-describedby={undefined}>
        <DialogTitle>Close PLVS?</DialogTitle>
        {error ? (
          <div className="mb-3 mt-2 text-[length:var(--ui-fs-control)] text-destructive">
            {error}
          </div>
        ) : (
          <div className="mb-3 mt-4 flex flex-col gap-1">
            <div className="flex min-h-[var(--ui-shell-h)] items-center justify-between gap-4">
              <span className={ROW_LABEL_CLASS}>Close Action</span>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger
                  aria-label="close action"
                  variant="inline"
                  className="text-popover-foreground"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" variant="inline">
                  <SelectItem value="tray">Minimize to Tray</SelectItem>
                  <SelectItem value="quit">Quit</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex min-h-[var(--ui-shell-h)] items-center justify-between gap-4">
              <span className={ROW_LABEL_CLASS}>Remember This Choice</span>
              <Switch
                aria-label="remember this choice"
                checked={dontAsk}
                onCheckedChange={setDontAsk}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={handleCancel} disabled={busy}>
            Cancel
          </Button>
          {error ? (
            <Button onClick={onRetry} disabled={busy}>
              {busy ? "Saving…" : "Retry"}
            </Button>
          ) : (
            <Button onClick={handleConfirm} disabled={busy}>
              {busy ? "Saving…" : actionLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
