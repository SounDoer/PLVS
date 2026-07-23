import { useState } from "react";
import { Check, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NOOP_PRESETS = {
  list: [],
  activeId: null,
  save: () => {},
  apply: () => {},
  update: () => {},
  rename: () => {},
  remove: () => {},
};

/**
 * Popover body for preset management. Receives the `presets` controller
 * from usePresets(). Whole-row click applies; row-tail icons do
 * Update / Rename / Delete. Rename is inline.
 */
export function PresetsPopoverContent({ presets = NOOP_PRESETS, showTitle = true }) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [drafts, setDrafts] = useState({});

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const result = presets.save(trimmed);
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
    <>
      {showTitle ? (
        <p className="px-2 py-1 text-[length:var(--ui-fs-caption)] font-semibold tracking-wide text-muted-foreground">
          Presets
        </p>
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
          placeholder="New preset name"
          size={15}
          className="h-7 min-w-0 max-w-full shrink [field-sizing:content] rounded-md border border-input bg-transparent px-2 py-1 text-[length:var(--ui-fs-control)] shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 px-2 text-[length:var(--ui-fs-control)]"
          onClick={handleSave}
          disabled={!name.trim()}
        >
          Save
        </Button>
      </div>
      {presets.list.length === 0 ? (
        <p className="px-2 py-1.5 text-[length:var(--ui-fs-control)] text-muted-foreground">
          No presets yet. Save the current view to start.
        </p>
      ) : (
        <div className="grid gap-0.5 p-1">
          {presets.list.map((preset) => {
            const isActive = preset.id === presets.activeId;
            const isDirty = isActive && presets.dirty === true;
            const isEditing = preset.id === editingId;
            return (
              <div key={preset.id} className="group">
                {isEditing ? (
                  <div className="flex items-center gap-1.5 rounded px-1.5 py-1">
                    <input
                      type="text"
                      value={drafts[preset.id] ?? preset.name ?? ""}
                      aria-label={`Rename preset ${preset.name}`}
                      onChange={(e) => setDrafts((c) => ({ ...c, [preset.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(preset.id);
                        if (e.key === "Escape") cancelRename();
                      }}
                      className="flex h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-[length:var(--ui-fs-control)] shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <button
                      type="button"
                      aria-label="Save rename"
                      onClick={() => commitRename(preset.id)}
                      disabled={!(drafts[preset.id] ?? "").trim()}
                      className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
                    >
                      <Check className="size-[length:var(--ui-icon-management-action)]" />
                    </button>
                    <button
                      type="button"
                      aria-label="Cancel rename"
                      onClick={cancelRename}
                      className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <X className="size-[length:var(--ui-icon-management-action)]" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded text-[length:var(--ui-fs-control)] transition-colors hover:bg-muted/50 focus-within:bg-muted/50">
                    <button
                      type="button"
                      aria-label={`Apply preset ${preset.name}`}
                      onClick={() => presets.apply(preset.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <span
                        aria-label={
                          isActive
                            ? `Active preset ${preset.name}${isDirty ? " (modified)" : ""}`
                            : undefined
                        }
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          isActive ? "bg-primary" : "bg-muted-foreground/20"
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {preset.name}
                        {isDirty ? " *" : ""}
                      </span>
                    </button>
                    <span className="flex shrink-0 items-center gap-0.5 pr-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <button
                        type="button"
                        aria-label={`Update preset ${preset.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          presets.update(preset.id);
                        }}
                        className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <RefreshCw className="size-[length:var(--ui-icon-management-action)]" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Rename preset ${preset.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(preset);
                        }}
                        className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <Pencil className="size-[length:var(--ui-icon-management-action)]" />
                      </button>
                      <InlineConfirm
                        onConfirm={() => presets.remove(preset.id)}
                        confirmLabel={`Confirm delete preset ${preset.name}`}
                        cancelLabel={`Cancel delete preset ${preset.name}`}
                        trigger={(arm) => (
                          <button
                            type="button"
                            aria-label={`Delete preset ${preset.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              arm();
                            }}
                            className="rounded text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            <Trash2 className="size-[length:var(--ui-icon-management-action)]" />
                          </button>
                        )}
                      />
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
