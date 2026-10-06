import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { COMPACT_SWITCH_CLASS, COMPACT_SWITCH_THUMB_CLASS } from "@/components/ui/controlStyles.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";

const SWITCH_CLASS = COMPACT_SWITCH_CLASS;

const SWITCH_THUMB_CLASS = COMPACT_SWITCH_THUMB_CLASS;

const ROW_LABEL_CLASS = "text-[length:var(--ui-fs-control)] font-medium text-muted-foreground";

/**
 * @param {{
 *   open: any,
 *   error?: any,
 *   busy?: any,
 *   onConfirm: any,
 *   onRetry: any,
 *   onCancel: any,
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
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleCancel();
      }}
    >
      <DialogContent size="custom" className="inline-flex">
        <DialogTitle className="sr-only">Close PLVS</DialogTitle>
        {error ? (
          <div className="mb-3 max-w-80 px-2 text-[length:var(--ui-fs-control)] text-destructive">
            {error}
          </div>
        ) : null}
        {!error ? (
          <>
            <div className="mb-2 flex min-h-[var(--ui-shell-h)] items-center justify-between gap-4 rounded-md px-2">
              <span className={ROW_LABEL_CLASS}>Close Behavior</span>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger
                  aria-label="Close behavior"
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

            <div className="mb-3 flex min-h-[var(--ui-shell-h)] items-center justify-between gap-4 rounded-md px-2">
              <span className={ROW_LABEL_CLASS}>Don&apos;t ask again</span>
              <Switch
                aria-label="Don't ask again"
                checked={dontAsk}
                onCheckedChange={setDontAsk}
                className={SWITCH_CLASS}
                thumbClassName={SWITCH_THUMB_CLASS}
              />
            </div>
          </>
        ) : null}

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
              {busy ? "Saving…" : "Confirm"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
