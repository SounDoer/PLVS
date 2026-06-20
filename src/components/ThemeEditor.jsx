import { useRef } from "react";
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
    title: "Brand",
    keys: ["primary", "primaryForeground", "ring", "destructive", "destructiveForeground"],
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
  pos,
  onMove,
}) {
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
        <span className="text-[length:var(--ui-fs-status)] text-muted-foreground">
          {draft.colorScheme}
        </span>
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
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onSave}>Save</Button>
        </div>
      </div>
    </div>
  );
}
