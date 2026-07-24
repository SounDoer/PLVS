import { Check, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
import {
  MANAGEMENT_ROW_ACTIONS_CLASS,
  MANAGEMENT_ROW_CLASS,
  ManagementIconAction,
} from "@/components/ManagementRow.jsx";
import { AddButton } from "@/components/AddButton";
import { TruncatingLabel } from "@/components/TruncatingLabel.jsx";
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
          // `size={1}` + `flex-1`: fill the row without the input's text inflating the `w-max`
          // popover; `min-w-0` scrolls a long value inside the field instead of pushing the
          // shrink-0 confirm/cancel buttons off-panel.
          size={1}
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-[length:var(--ui-fs-control)] shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          autoFocus
        />
        <ManagementIconAction
          label={`Save ${title} name`}
          icon={<Check className="size-[length:var(--ui-icon-management-action)]" />}
          className="shrink-0"
          onClick={commitRename}
        />
        <ManagementIconAction
          label={`Cancel ${title} rename`}
          icon={<X className="size-[length:var(--ui-icon-management-action)]" />}
          className="shrink-0"
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
          <def.Icon className="size-[1.25em]" />
        </span>
      ) : null}
      <TruncatingLabel text={title} className="min-w-0 flex-1 text-left text-foreground" />
      <span className={MANAGEMENT_ROW_ACTIONS_CLASS}>
        <ManagementIconAction
          label={`Rename ${title}`}
          icon={<Pencil className="size-[length:var(--ui-icon-management-action)]" />}
          onClick={startRename}
        />
        <InlineConfirm
          onConfirm={() => removePanel(panelId)}
          confirmLabel={`Confirm delete ${title}`}
          cancelLabel={`Cancel delete ${title}`}
          trigger={(arm) => (
            <ManagementIconAction
              label={`Delete ${title}`}
              icon={<Trash2 className="size-[length:var(--ui-icon-management-action)]" />}
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
        <AddButton label="Add Panel" className="min-w-0" />
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
              <Icon className="size-[1.25em]" />
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
      {/* `grid-cols-1` (= minmax(0,1fr)) constrains the column to the popover width; a bare grid
          makes an implicit auto column that sizes to the longest name and overflows the max-w cap,
          so `truncate` on the rows never kicks in. */}
      <div className="grid grid-cols-1 w-full min-w-0 gap-0.5">
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
              <RotateCcw className="size-[length:var(--ui-icon-management-action)]" />
            </button>
          )}
        />
      </div>
    </>
  );
}
