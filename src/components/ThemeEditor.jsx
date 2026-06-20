import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ColorControl } from "./ColorControl.jsx";
import { clampPanelPos } from "../lib/dragClamp.js";

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
          className="flex cursor-move items-center justify-between border-b border-border px-3 py-2"
        >
          <input
            aria-label="Theme name"
            value={draft.name}
            onInput={(e) => onName(e.target.value)}
            className="bg-transparent text-[length:var(--ui-fs-panel-title)] font-semibold"
          />
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
            <Dialog.Title className="mb-3 text-sm font-semibold text-foreground">
              Discard theme changes?
            </Dialog.Title>
            <Dialog.Description className="mb-6 text-sm text-muted-foreground">
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
