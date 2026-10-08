import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { LAYER_ABOVE_EDITOR } from "@/components/ui/layers.js";
import { useRef } from "react";
import { useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";
import { useEditorDraftDecision } from "../agentControl/EditorDraftContext.jsx";

/**
 * Modal confirmation for one destructive action.
 *
 * The heavier sibling of `InlineConfirm`, which arms a single control in place. Use that one for
 * an action whose cost is one item the user can recreate; use this one when the consequence needs
 * words -- unsaved work about to be discarded, or state about to be wiped app-wide.
 *
 * Its layer sits above a draggable editor panel, which is where both discard confirmations live.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {string} props.title
 * @param {string} props.description
 * @param {string} props.confirmLabel   text of the destructive button
 * @param {string} [props.cancelLabel]  text of the dismissing button
 * @param {() => void} props.onConfirm  runs after the dialog closes itself
 * @param {{editorKind: string, editorSurfaceId: string}|null} [props.editorDraftDecision]
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  editorDraftDecision = null,
}) {
  const previousOpenRef = useRef(false);
  const decisionLifetimeRef = useRef(0);
  if (open && !previousOpenRef.current) decisionLifetimeRef.current += 1;
  previousOpenRef.current = open;
  const cancel = () => onOpenChange(false);
  const confirm = () => {
    onOpenChange(false);
    onConfirm();
  };
  const decisionSurfaceId = useUiSurface({
    active: open,
    lifetimeKey: editorDraftDecision
      ? `${editorDraftDecision.editorSurfaceId}:${decisionLifetimeRef.current}`
      : undefined,
    kind: "confirmation",
    origin: "nested",
    blocking: true,
    dismissible: true,
    supportedActions: ["cancel"],
    target: editorDraftDecision
      ? {
          phase: "decision",
          purpose: "discardDraft",
          editorKind: editorDraftDecision.editorKind,
          editorSurfaceId: editorDraftDecision.editorSurfaceId,
        }
      : { phase: "decision" },
    onCancel: cancel,
  });
  useEditorDraftDecision({
    active: open && editorDraftDecision != null,
    decisionSurfaceId,
    editorKind: editorDraftDecision?.editorKind,
    editorSurfaceId: editorDraftDecision?.editorSurfaceId,
    onDiscard: confirm,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog" size="sm" layer={LAYER_ABOVE_EDITOR}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <DialogFooter className="mt-3">
          <Button variant="ghost" onClick={cancel}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" onClick={confirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
