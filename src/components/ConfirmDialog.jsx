import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { LAYER_ABOVE_EDITOR } from "@/components/ui/layers.js";

/**
 * Modal confirmation for one destructive action.
 *
 * The heavier sibling of `InlineConfirm`, which arms a single control in place. Use that one for
 * an action whose cost is one item the user can recreate; use this one when the consequence needs
 * words -- unsaved work about to be discarded, or state about to be wiped app-wide.
 *
 * Its layer sits above a draggable editor panel, which is where both discard confirmations live.
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog" size="sm" layer={LAYER_ABOVE_EDITOR}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <DialogFooter className="mt-3">
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
