import { useMemo, useState } from "react";
import { Check, Download, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { AddButton } from "@/components/AddButton";
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
import { TruncatingLabel } from "@/components/TruncatingLabel.jsx";
import { POPOVER_HEADER_CLASS, POPOVER_TITLE_CLASS } from "@/components/ui/surfaceStyles.js";
import { cn } from "@/lib/utils";
import { usePointerReorder } from "@/hooks/usePointerReorder.js";
import { IconAction } from "@/components/ui/icon-action";
import { DragHandle } from "@/components/ui/drag-handle";
import { RowAction } from "@/components/ui/row";

const NOOP_PRESETS = {
  list: [],
  activeId: null,
  save: () => {},
  apply: () => {},
  update: () => {},
  rename: () => {},
  remove: () => {},
  reorder: () => {},
};

/**
 * Popover body for preset management. Receives the `presets` controller
 * from usePresets(). Whole-row click applies; row-tail icons do
 * Update / Rename / Delete. Rename is inline.
 */
export function PresetsPopoverContent({
  presets = NOOP_PRESETS,
  showTitle = true,
  onExport = () => {},
}) {
  // Apply, Add and Update capture or replace the whole scene, so they are refused while a
  // draft-style editor is open. The controller refuses them whatever this renders; showing them
  // disabled is what makes the refusal legible, and the caption below says how to clear it.
  //
  // Deliberately not per-preset: a preset that carries no dock state is no safer to apply than one
  // that does, and a rule that depended on the row's contents could not be read off the screen.
  const blocked = presets.blocked === true;
  const blockedClass = "disabled:opacity-50";
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const newPresetPlaceholder =
    presets.list.length === 0 ? "Name your first preset" : "New preset name";

  const presetIds = useMemo(() => presets.list.map((preset) => preset.id), [presets.list]);
  const { containerRef, orderedIds, draggingId, startDrag } = usePointerReorder(
    presetIds,
    (nextIds) => presets.reorder?.(nextIds)
  );
  const presetsById = useMemo(
    () => new Map(presets.list.map((preset) => [preset.id, preset])),
    [presets.list]
  );
  const orderedList = orderedIds.map((id) => presetsById.get(id)).filter(Boolean);

  // The controller rejects rather than returning false when blocked, and blocked is the only
  // rejection these produce here; the dock's proxy returns nothing at all. Neither is worth an
  // unhandled rejection, and the caption below has already said what happened.
  const runPresetAction = (result) => {
    if (result && typeof result.catch === "function") result.catch(() => {});
    return result;
  };

  const handleSave = () => {
    if (blocked) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const result = runPresetAction(presets.save(trimmed));
    if (result && typeof result.then === "function") {
      result.then((v) => {
        if (v !== false) setName("");
      });
      return;
    }
    if (result !== false) setName("");
  };

  const startRename = (preset) => {
    setEditingId(preset.id);
    setDrafts((c) => ({ ...c, [preset.id]: preset.name ?? "" }));
  };

  const cancelRename = () => setEditingId(null);

  const commitRename = (id) => {
    const trimmed = (drafts[id] ?? "").trim();
    if (!trimmed) return;
    presets.rename(id, trimmed);
    setEditingId(null);
  };

  return (
    <div className="min-w-[min(calc(15em+4rem),calc(92vw-1rem))] text-[length:var(--ui-fs-control)]">
      {showTitle ? (
        <p className={`${POPOVER_HEADER_CLASS} ${POPOVER_TITLE_CLASS}`}>Presets</p>
      ) : null}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <input
          type="text"
          aria-label="New preset name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          placeholder={newPresetPlaceholder}
          // `size={1}` + `flex-1`: fill the responsive Presets surface without typed text growing
          // it, and `min-w-0` still permits shrinking at the viewport cap.
          size={1}
          className="plvs-input h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-[length:var(--ui-fs-control)] placeholder:text-muted-foreground"
        />
        <AddButton
          label="Add"
          aria-label="Add preset"
          className={cn("w-auto shrink-0", blockedClass)}
          onClick={handleSave}
          disabled={blocked || !name.trim()}
        />
      </div>
      {presets.list.length > 0 ? (
        // `grid-cols-1` (= minmax(0,1fr)) constrains the column to the popover width; a bare grid
        // makes an implicit auto column that sizes to the longest name and overflows the max-w cap,
        // so `truncate` on the rows never kicks in.
        <div ref={containerRef} className="grid grid-cols-1 gap-0.5 p-1">
          {orderedList.map((preset) => {
            const isActive = preset.id === presets.activeId;
            const isDirty = isActive && presets.dirty === true;
            const isEditing = preset.id === editingId;
            return (
              <div key={preset.id} className="group">
                {isEditing ? (
                  <div className="flex items-center gap-1.5 rounded-xs px-1.5 py-1">
                    <input
                      type="text"
                      value={drafts[preset.id] ?? preset.name ?? ""}
                      aria-label={`Rename preset ${preset.name}`}
                      onChange={(e) => setDrafts((c) => ({ ...c, [preset.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(preset.id);
                        if (e.key === "Escape") cancelRename();
                      }}
                      // `size={1}` + `flex-1`: fill the row without the input's text inflating the
                      // `w-max` popover; `min-w-0` scrolls a long value inside the field instead of
                      // pushing the shrink-0 confirm/cancel buttons off-panel.
                      size={1}
                      autoFocus
                      className="plvs-input h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-[length:var(--ui-fs-control)]"
                    />
                    <IconAction
                      aria-label="Save rename"
                      onClick={() => commitRename(preset.id)}
                      disabled={!(drafts[preset.id] ?? "").trim()}
                      className="shrink-0 disabled:opacity-50"
                    >
                      <Check className="size-[length:var(--ui-icon-management-action)]" />
                    </IconAction>
                    <IconAction
                      aria-label="Cancel rename"
                      onClick={cancelRename}
                      className="shrink-0"
                    >
                      <X className="size-[length:var(--ui-icon-management-action)]" />
                    </IconAction>
                  </div>
                ) : (
                  <div
                    className={cn(
                      "flex items-center gap-1 rounded-xs text-[length:var(--ui-fs-control)] hover:bg-ui-hover focus-within:bg-ui-hover",
                      draggingId === preset.id && "z-10 ring-1 ring-primary"
                    )}
                  >
                    <DragHandle
                      aria-label={`Reorder ${preset.name}`}
                      onPointerDown={(event) => startDrag(preset.id, event)}
                      dragging={draggingId === preset.id}
                    />
                    <RowAction
                      aria-label={`Apply preset ${preset.name}`}
                      onClick={() => runPresetAction(presets.apply(preset.id))}
                      disabled={blocked}
                      // `pl-1 pr-1.5`, not the shorthand `px-1.5`: this button sits right after
                      // the drag handle, so the left side doesn't need a second helping of the
                      // handle's own gap.
                      className={cn("pl-1 pr-1.5 py-1.5", blockedClass)}
                    >
                      <span
                        aria-label={
                          isActive
                            ? `Active preset ${preset.name}${isDirty ? " (modified)" : ""}`
                            : undefined
                        }
                        className={cn(
                          "size-1.5 shrink-0 rounded-full border",
                          isActive
                            ? "border-primary bg-primary"
                            : "border-muted-foreground bg-transparent"
                        )}
                      />
                      <TruncatingLabel
                        text={`${preset.name}${isDirty ? " *" : ""}`}
                        className="min-w-0 flex-1 text-foreground"
                      />
                    </RowAction>
                    <span className="flex shrink-0 items-center gap-0.5 pr-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                      <IconAction
                        aria-label={`Update preset ${preset.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          runPresetAction(presets.update(preset.id));
                        }}
                        disabled={blocked}
                        className={blockedClass}
                      >
                        <RefreshCw className="size-[length:var(--ui-icon-management-action)]" />
                      </IconAction>
                      <IconAction
                        aria-label={`Export preset ${preset.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onExport(preset.id);
                        }}
                      >
                        <Download className="size-[length:var(--ui-icon-management-action)]" />
                      </IconAction>
                      <IconAction
                        aria-label={`Rename preset ${preset.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(preset);
                        }}
                      >
                        <Pencil className="size-[length:var(--ui-icon-management-action)]" />
                      </IconAction>
                      <InlineConfirm
                        onConfirm={() => presets.remove(preset.id)}
                        confirmLabel={`Confirm delete preset ${preset.name}`}
                        cancelLabel={`Cancel delete preset ${preset.name}`}
                        trigger={(arm) => (
                          <IconAction
                            aria-label={`Delete preset ${preset.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              arm();
                            }}
                            className="hover:text-destructive"
                          >
                            <Trash2 className="size-[length:var(--ui-icon-management-action)]" />
                          </IconAction>
                        )}
                      />
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {blocked ? (
        <p className="px-2 py-1.5 text-[length:var(--ui-fs-caption)] leading-snug text-muted-foreground">
          Finish or cancel the active editor first.
        </p>
      ) : null}
    </div>
  );
}
