import { Check, GripVertical, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
import {
  MANAGEMENT_ROW_ACTIONS_CLASS,
  MANAGEMENT_ROW_CLASS,
  ManagementIconAction,
} from "@/components/ManagementRow.jsx";
import { AddButton } from "@/components/AddButton";
import { PanelSettingsHeader } from "@/components/PanelSettingsHeader.jsx";
import { TruncatingLabel } from "@/components/TruncatingLabel.jsx";
import { cn } from "@/lib/utils";
import { useDrag } from "./DragContext.jsx";
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
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-[length:var(--ui-fs-control)] shadow-sm"
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

function AddModuleRow({ id, title, Icon, onAdd }) {
  const { onCreateMouseDown } = useDrag();

  return (
    <div className={cn(MANAGEMENT_ROW_CLASS, "text-foreground")}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => onAdd(id)}
      >
        <span className="flex shrink-0 text-muted-foreground">
          <Icon className="size-[1.25em]" />
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
      <span className={MANAGEMENT_ROW_ACTIONS_CLASS}>
        <button
          type="button"
          aria-label={`Drag ${title} to place`}
          title="Drag to place"
          onMouseDown={(e) => onCreateMouseDown(e, id)}
          className="flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </button>
      </span>
    </div>
  );
}

function AddModuleView({ onAdd, onBack }) {
  return (
    <>
      <PanelSettingsHeader title="Add Module" onBack={onBack} />
      {/* `grid-cols-1` (= minmax(0,1fr)) constrains the column to the popover width; a bare grid
          makes an implicit auto column that sizes to the longest name and overflows the max-w cap,
          so `truncate` on the rows never kicks in. */}
      <div className="mt-1 grid w-full min-w-0 grid-cols-1 gap-0.5">
        {Object.values(MODULE_REGISTRY).map(({ id, title, Icon }) => (
          <AddModuleRow key={id} id={id} title={title} Icon={Icon} onAdd={onAdd} />
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Modules Popover - manage panel instances from the header
// ---------------------------------------------------------------------------

export function ModulesPopoverContent() {
  const { state, addPanel, resetWorkspace, setHoveredPanelId } = useWorkspaceStore();
  const panelIds = state.panelOrder.filter((id) => state.panelsById[id]);
  const [adding, setAdding] = useState(false);

  useEffect(() => () => setHoveredPanelId(null), [setHoveredPanelId]);

  if (adding) {
    return <AddModuleView onAdd={addPanel} onBack={() => setAdding(false)} />;
  }

  return (
    <>
      <p className="px-2 py-1 text-[length:var(--ui-fs-caption)] font-semibold tracking-wide text-muted-foreground">
        Modules
      </p>
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
        <AddButton label="Add Module" className="min-w-0 flex-1" onClick={() => setAdding(true)} />
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
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <RotateCcw className="size-[length:var(--ui-icon-management-action)]" />
            </button>
          )}
        />
      </div>
    </>
  );
}
