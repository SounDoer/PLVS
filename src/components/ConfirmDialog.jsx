import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { SCRIM_CLASS } from "@/components/ui/surfaceStyles.js";
import { cn } from "@/lib/utils";

/**
 * Modal confirmation for one destructive action.
 *
 * The heavier sibling of `InlineConfirm`, which arms a single control in place. Use that one for
 * an action whose cost is one item the user can recreate; use this one when the consequence needs
 * words -- unsaved work about to be discarded, or state about to be wiped app-wide.
 *
 * The z-index pair sits above a draggable editor panel, which is where both discard confirmations
 * live.
 *
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {string} props.title
 * @param {string} props.description
 * @param {string} props.confirmLabel   text of the destructive button
 * @param {string} [props.cancelLabel]  text of the dismissing button
 * @param {() => void} props.onConfirm  runs after the dialog closes itself
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(SCRIM_CLASS, "z-[60]")} />
        <Dialog.Content
          role="alertdialog"
          className="fixed left-1/2 top-1/2 z-[61] w-80 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-xl"
        >
          <Dialog.Title className="mb-3 text-[length:var(--ui-fs-body)] font-semibold text-foreground">
            {title}
          </Dialog.Title>
          <Dialog.Description className="mb-6 text-[length:var(--ui-fs-body)] text-muted-foreground">
            {description}
          </Dialog.Description>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onOpenChange(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
