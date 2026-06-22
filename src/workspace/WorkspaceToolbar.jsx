import { Check, LayoutGrid, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MODULE_REGISTRY } from "./registry.jsx";
import { useWorkspaceStore } from "./WorkspaceContext.jsx";
import { resolvePanelDefinition, resolvePanelDisplayName } from "./panelInstances.js";

function IconAction({ label, icon, onClick, className = "" }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`rounded p-0.5 text-muted-foreground opacity-70 transition-colors hover:text-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${className}`}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

function PanelRow({ panelId }) {
  const { state, removePanel, renamePanel, setHoveredPanelId } = useWorkspaceStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const title = resolvePanelDisplayName(state, panelId);
  const def = resolvePanelDefinition(state, panelId);

  const startRename = () => {
    setDraft(state.panelsById[panelId]?.customTitle ?? title);
    setEditing(true);
  };

  const commitRename = () => {
    renamePanel(panelId, draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex w-full items-center gap-1 rounded px-1.5 py-1">
        <input
          type="text"
          aria-label={`Rename ${title}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename();
            if (event.key === "Escape") setEditing(false);
          }}
          className="flex h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          autoFocus
        />
        <IconAction
          label={`Save ${title} name`}
          icon={<Check className="size-3.5" />}
          onClick={commitRename}
        />
        <IconAction
          label={`Cancel ${title} rename`}
          icon={<X className="size-3.5" />}
          onClick={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div
      className="group flex w-full min-w-44 items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-muted/50"
      onMouseEnter={() => setHoveredPanelId(panelId)}
      onMouseLeave={() => setHoveredPanelId(null)}
    >
      {def?.Icon ? (
        <span className="flex shrink-0 text-muted-foreground">
          <def.Icon />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-left text-foreground">{title}</span>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <IconAction
          label={`Rename ${title}`}
          icon={<Pencil className="size-3.5" />}
          onClick={startRename}
        />
        <InlineConfirm
          onConfirm={() => removePanel(panelId)}
          confirmLabel={`Confirm delete ${title}`}
          cancelLabel={`Cancel delete ${title}`}
          trigger={(arm) => (
            <IconAction
              label={`Delete ${title}`}
              icon={<Trash2 className="size-3.5" />}
              className="hover:text-destructive"
              onClick={arm}
            />
          )}
        />
      </span>
    </div>
  );
}

function AddPanelControl() {
  const { addPanel } = useWorkspaceStore();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-1 flex h-7 w-full items-center justify-center gap-1.5 rounded border border-border/70 bg-transparent px-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Plus className="size-3.5" />
          Add Panel
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-max min-w-44 max-w-[92vw] p-1">
        {Object.values(MODULE_REGISTRY).map(({ id, title, Icon }) => (
          <button
            key={id}
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/50"
            onClick={() => {
              addPanel(id);
              setOpen(false);
            }}
          >
            <span className="flex shrink-0 text-muted-foreground">
              <Icon />
            </span>
            <span className="min-w-0 flex-1 truncate text-left">{title}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Modules Popover - manage panel instances from the header
// ---------------------------------------------------------------------------

export function ModulesPopoverContent() {
  const { state, resetWorkspace, setHoveredPanelId } = useWorkspaceStore();
  const panelIds = state.panelOrder.filter((id) => state.panelsById[id]);

  useEffect(() => () => setHoveredPanelId(null), [setHoveredPanelId]);

  return (
    <>
      <div className="grid w-max min-w-44 max-w-full gap-0.5">
        {panelIds.map((panelId) => (
          <PanelRow key={panelId} panelId={panelId} />
        ))}
        {panelIds.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No panels</p>
        ) : null}
      </div>
      <AddPanelControl />
      <div className="mt-1 flex justify-end">
        <InlineConfirm
          onConfirm={resetWorkspace}
          confirmLabel="Confirm reset layout"
          cancelLabel="Cancel reset layout"
          trigger={(arm) => (
            <button
              type="button"
              aria-label="Reset layout"
              onClick={arm}
              className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              Reset
            </button>
          )}
        />
      </div>
    </>
  );
}

export function VisibilityPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Modules"
          className="flex h-7 w-7 items-center justify-center rounded border border-border/60 bg-card/40 text-muted-foreground transition-colors hover:bg-card/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          <LayoutGrid size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-max min-w-44 max-w-[92vw] p-1">
        <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
          Modules
        </p>
        <ModulesPopoverContent />
      </PopoverContent>
    </Popover>
  );
}
