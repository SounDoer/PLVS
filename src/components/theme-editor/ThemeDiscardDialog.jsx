import { ConfirmDialog } from "@/components/ConfirmDialog.jsx";

/** @param {Pick<import("react").ComponentProps<typeof ConfirmDialog>, "open" | "onOpenChange" | "onConfirm" | "editorDraftDecision">} props */
export function ThemeDiscardDialog(props) {
  return (
    <ConfirmDialog
      {...props}
      title="Discard theme changes?"
      description="Unsaved edits will be discarded and the previous theme will be restored."
      cancelLabel="Keep Editing"
      confirmLabel="Discard Changes"
    />
  );
}
