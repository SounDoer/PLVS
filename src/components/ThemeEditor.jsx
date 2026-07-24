import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ColorControl } from "./ColorControl.jsx";
import { clampPanelPos } from "../lib/dragClamp.js";

// Muted icon buttons in the editor header (rename pencil, and the confirm/cancel while renaming),
// matching LoudnessProfileEditor. `onPointerDown` on each stops the drag handle grabbing the click.
const HEADER_ACTION_CLASS =
  "shrink-0 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const SHELL_GROUPS = [
  {
    title: "Surface",
    keys: ["background", "card", "popover", "secondary", "muted", "accent"],
  },
  {
    title: "Text",
    keys: [
      "foreground",
      "cardForeground",
      "popoverForeground",
      "mutedForeground",
      "secondaryForeground",
      "accentForeground",
    ],
  },
  {
    // primary + ring are not listed: they follow the accent seed (see buildThemeTokens), not the shell.
    title: "Brand",
    keys: ["primaryForeground", "destructive", "destructiveForeground"],
  },
  { title: "Lines", keys: ["border", "input"] },
];

/**
 * @param {{
 *   draft: object,
 *   onName: (s: string) => void,
 *   onSeed: (key: string, css: string) => void,
 *   onShell: (key: string, css: string) => void,
 *   onSave: () => void,
 *   onCancel: () => void,
 *   onDelete?: () => void,
 *   dirty?: boolean,
 *   pos: {x:number,y:number},
 *   onMove: (p: {x:number,y:number}) => void,
 * }} props
 */
export function ThemeEditor({
  draft,
  onName,
  onSeed,
  onShell,
  onSave,
  onCancel,
  onDelete,
  dirty,
  pos,
  onMove,
}) {
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);

  // The name edits like the Loudness Profile editor: static until the pencil opens an input, which
  // commits on blur / Enter / the confirm button and reverts on Escape / the cancel button.
  // `skipNameCommit` lets Escape blur without committing.
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(draft.name ?? "");
  const skipNameCommit = useRef(false);
  const nameInputRef = useRef(null);

  useEffect(() => {
    if (!renaming) setNameDraft(draft.name ?? "");
  }, [draft.name, renaming]);

  useEffect(() => {
    if (renaming) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [renaming]);

  function startRename() {
    setNameDraft(draft.name ?? "");
    setRenaming(true);
  }

  function commitName() {
    if (skipNameCommit.current) {
      skipNameCommit.current = false;
      setRenaming(false);
      return;
    }
    onName(nameDraft);
    setRenaming(false);
  }

  /// The cancel button's explicit path, twin of Escape: close the field, keep the stored name.
  function cancelName() {
    setNameDraft(draft.name ?? "");
    setRenaming(false);
  }

  function handleCancel() {
    if (!dirty) {
      onCancel();
      return;
    }
    setDiscardDialogOpen(true);
  }

  function handleDiscardChanges() {
    setDiscardDialogOpen(false);
    onCancel();
  }

  const ref = useRef(null);
  const dragRef = useRef(null);

  function onPointerDown(e) {
    const rect = ref.current.getBoundingClientRect();
    dragRef.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      w: rect.width,
      h: rect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    onMove(
      clampPanelPos(
        { x: e.clientX - d.dx, y: e.clientY - d.dy },
        { w: d.w, h: d.h },
        { w: window.innerWidth, h: window.innerHeight }
      )
    );
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  return (
    <>
      <div
        ref={ref}
        role="dialog"
        aria-label="Theme editor"
        className="fixed z-50 flex max-h-[80vh] w-80 flex-col gap-2 overflow-hidden rounded-[var(--ui-radius-modal)] border border-border bg-card text-card-foreground shadow-lg"
        style={{ left: pos.x, top: pos.y }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="flex cursor-move items-center gap-1.5 border-b border-border px-3 py-2"
        >
          {renaming ? (
            <>
              <input
                ref={nameInputRef}
                aria-label="Theme name"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                // The header is a drag handle; stop the pointer so selecting text never drags the
                // window.
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    skipNameCommit.current = true;
                    event.currentTarget.blur();
                  }
                }}
                onBlur={commitName}
                className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-[length:var(--ui-fs-panel-title)] font-semibold shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              {/* `preventDefault` on mousedown keeps the input focused so the click commits/cancels
                  explicitly rather than racing the input's blur. */}
              <button
                type="button"
                aria-label="Save theme name"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.preventDefault()}
                onClick={commitName}
                className={HEADER_ACTION_CLASS}
              >
                <Check className="size-[length:var(--ui-icon-management-action)]" />
              </button>
              <button
                type="button"
                aria-label="Cancel rename"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.preventDefault()}
                onClick={cancelName}
                className={HEADER_ACTION_CLASS}
              >
                <X className="size-[length:var(--ui-icon-management-action)]" />
              </button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-[length:var(--ui-fs-panel-title)] font-semibold">
                {draft.name?.trim() ? (
                  draft.name
                ) : (
                  <span className="text-muted-foreground">Untitled</span>
                )}
              </span>
              <button
                type="button"
                aria-label="Rename theme"
                title="Rename"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={startRename}
                className={HEADER_ACTION_CLASS}
              >
                <Pencil className="size-[length:var(--ui-icon-management-action)]" />
              </button>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto px-3 py-2">
          <section className="flex flex-col gap-1.5">
            <Label>Seeds</Label>
            <ColorControl
              label="Accent"
              value={draft.seeds.accent}
              onChange={(c) => onSeed("accent", c)}
            />
            <ColorControl
              label="Accent 2"
              value={draft.seeds.accentSecondary}
              onChange={(c) => onSeed("accentSecondary", c)}
            />
            <ColorControl
              label="Signal Good"
              value={draft.seeds.signal.good}
              onChange={(c) => onSeed("good", c)}
            />
            <ColorControl
              label="Signal Warn"
              value={draft.seeds.signal.warn}
              onChange={(c) => onSeed("warn", c)}
            />
            <ColorControl
              label="Signal Bad"
              value={draft.seeds.signal.bad}
              onChange={(c) => onSeed("bad", c)}
            />
          </section>
          {SHELL_GROUPS.map((g) => (
            <section key={g.title} className="flex flex-col gap-1.5">
              <Label>{g.title}</Label>
              {g.keys.map((k) => (
                <ColorControl
                  key={k}
                  label={k}
                  value={draft.semantic[k]}
                  onChange={(c) => onShell(k, c)}
                />
              ))}
            </section>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          {onDelete ? (
            <Button variant="ghost" onClick={onDelete} className="text-destructive">
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={onSave}>Save</Button>
          </div>
        </div>
      </div>
      <Dialog.Root open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60" />
          <Dialog.Content
            role="alertdialog"
            className="fixed left-1/2 top-1/2 z-[61] w-80 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-xl focus:outline-none"
          >
            <Dialog.Title className="mb-3 text-[length:var(--ui-fs-body)] font-semibold text-foreground">
              Discard theme changes?
            </Dialog.Title>
            <Dialog.Description className="mb-6 text-[length:var(--ui-fs-body)] text-muted-foreground">
              Unsaved edits will be discarded and the previous theme will be restored.
            </Dialog.Description>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDiscardDialogOpen(false)}>
                Keep Editing
              </Button>
              <Button variant="destructive" onClick={handleDiscardChanges}>
                Discard Changes
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
