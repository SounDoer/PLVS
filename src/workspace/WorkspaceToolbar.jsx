import { Check, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
import {
  MANAGEMENT_ROW_ACTIONS_CLASS,
  MANAGEMENT_ROW_CLASS,
  ManagementIconAction,
} from "@/components/ManagementRow.jsx";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { MODULE_REGISTRY } from "./registry.jsx";
import { useWorkspaceStore } from "./WorkspaceContext.jsx";
import { resolvePanelDefinition, resolvePanelDisplayName } from "./panelInstances.js";

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
          className="flex h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-[length:var(--ui-fs-control)] shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          autoFocus
        />
        <ManagementIconAction
          label={`Save ${title} name`}
          icon={<Check className="size-3.5" />}
          onClick={commitRename}
        />
        <ManagementIconAction
          label={`Cancel ${title} rename`}
          icon={<X className="size-3.5" />}
          onClick={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(MANAGEMENT_ROW_CLASS, "min-w-44")}
      onMouseEnter={() => setHoveredPanelId(panelId)}
      onMouseLeave={() => setHoveredPanelId(null)}
    >
      {def?.Icon ? (
        <span className="flex shrink-0 text-muted-foreground">
          <def.Icon />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-left text-foreground">{title}</span>
      <span className={MANAGEMENT_ROW_ACTIONS_CLASS}>
        <ManagementIconAction
          label={`Rename ${title}`}
          icon={<Pencil className="size-3.5" />}
          onClick={startRename}
        />
        <InlineConfirm
          onConfirm={() => removePanel(panelId)}
          confirmLabel={`Confirm delete ${title}`}
          cancelLabel={`Cancel delete ${title}`}
          trigger={(arm) => (
            <ManagementIconAction
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
        <Button
          variant="secondary"
          size="sm"
          className="h-7 min-w-0 flex-1 px-2 text-[length:var(--ui-fs-control)]"
        >
          <Plus className="size-3.5" />
          Add Panel
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-max min-w-44 max-w-[92vw] p-1">
        {Object.values(MODULE_REGISTRY).map(({ id, title, Icon }) => (
          <button
            key={id}
            type="button"
            className={cn(MANAGEMENT_ROW_CLASS, "text-foreground")}
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
          <p className="px-2 py-1.5 text-[length:var(--ui-fs-control)] text-muted-foreground">
            No panels
          </p>
        ) : null}
      </div>
      <div className="mt-1 flex items-center gap-1 border-t border-border/30 pt-1">
        <AddPanelControl />
        <InlineConfirm
          onConfirm={resetWorkspace}
          confirmLabel="Confirm reset layout"
          cancelLabel="Cancel reset layout"
          trigger={(arm) => (
            <button
              type="button"
              aria-label="Reset layout"
              title="Reset layout"
              onClick={arm}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <RotateCcw className="size-3.5" />
            </button>
          )}
        />
      </div>
    </>
  );
}
