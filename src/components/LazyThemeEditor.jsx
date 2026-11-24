import { lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { FLOATING_EDITOR_CLASS } from "@/components/ui/surfaceStyles.js";
import { ThemeDiscardDialog } from "./theme-editor/ThemeDiscardDialog.jsx";

/** @typedef {import("react").ComponentProps<typeof import("./ThemeEditor.jsx").ThemeEditor>} ThemeEditorProps */

const ThemeEditor = lazy(loadThemeEditor);

/** @returns {Promise<{ default: import("react").ComponentType<ThemeEditorProps> }>} */
function loadThemeEditor() {
  return import("./ThemeEditor.jsx").then(
    ({ ThemeEditor }) => ({ default: ThemeEditor }),
    () => ({ default: ThemeEditorUnavailable })
  );
}

/** @param {ThemeEditorProps} props */
export function LazyThemeEditor(props) {
  return (
    <Suspense fallback={<ThemeEditorPlaceholder {...props} />}>
      <ThemeEditor {...props} />
    </Suspense>
  );
}

/** @param {ThemeEditorProps} props */
function ThemeEditorUnavailable(props) {
  return <ThemeEditorPlaceholder {...props} unavailable />;
}

/** @param {ThemeEditorProps & { unavailable?: boolean }} props */
function ThemeEditorPlaceholder({
  unavailable = false,
  pos,
  onCancel,
  onDismiss = onCancel,
  discardOpen = false,
  onDiscardOpenChange,
  onConfirmDiscard = onCancel,
  editorDraftDecision,
}) {
  return (
    <>
      <div
        role="dialog"
        aria-label="Theme editor"
        data-settings-editor
        className={FLOATING_EDITOR_CLASS}
        style={{ left: pos.x, top: pos.y }}
      >
        <p
          role={unavailable ? "alert" : "status"}
          className="px-3 py-2 text-[length:var(--ui-fs-control)]"
        >
          {unavailable ? "Could not load the theme editor." : "Loading theme editor…"}
        </p>
        <div className="flex justify-end border-t border-border px-3 py-2">
          <Button variant="ghost" onClick={onDismiss}>
            Cancel
          </Button>
        </div>
      </div>
      <ThemeDiscardDialog
        open={discardOpen}
        onOpenChange={onDiscardOpenChange}
        onConfirm={onConfirmDiscard}
        editorDraftDecision={editorDraftDecision}
      />
    </>
  );
}
