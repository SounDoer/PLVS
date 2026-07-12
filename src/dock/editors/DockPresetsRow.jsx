import { useState } from "react";
import { cn } from "@/lib/utils";

/** In-strip presets row: chips apply on click; inline input saves a new one. */
export function DockPresetsRow({ presets, onDone }) {
  const [name, setName] = useState("");
  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Mirror PresetsPopover: only clear the input once the save went through.
    Promise.resolve(presets.save(trimmed)).then((v) => {
      if (v !== false) setName("");
    });
  };
  return (
    <div className="flex h-full min-w-0 items-center gap-1.5 overflow-x-auto px-2">
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        Presets
      </span>
      {presets.list.map((preset) => (
        <button
          key={preset.id}
          type="button"
          aria-label={`Apply preset ${preset.name}`}
          onClick={() => presets.apply(preset.id)}
          className={cn(
            "h-6 shrink-0 truncate rounded-full border px-2 text-[10px] font-medium transition-colors",
            preset.id === presets.activeId
              ? "border-primary/50 bg-primary/15 text-foreground"
              : "border-border/60 text-muted-foreground hover:bg-muted/40"
          )}
        >
          {preset.name}
          {preset.id === presets.activeId && presets.dirty ? " *" : ""}
        </button>
      ))}
      <input
        type="text"
        aria-label="New preset name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
        }}
        placeholder="New preset"
        className="h-6 w-24 shrink-0 rounded-full border border-input bg-transparent px-2 text-[10px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <button
        type="button"
        onClick={save}
        disabled={!name.trim()}
        className="h-6 shrink-0 rounded-full bg-secondary px-2.5 text-[10px] font-semibold text-secondary-foreground hover:brightness-110 disabled:opacity-40"
      >
        Save
      </button>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onDone}
        className="h-6 shrink-0 rounded-full bg-secondary px-2.5 text-[10px] font-semibold text-secondary-foreground hover:brightness-110"
      >
        Done
      </button>
    </div>
  );
}
