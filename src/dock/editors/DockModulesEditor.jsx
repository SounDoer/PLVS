import { useEffect, useMemo, useRef, useState } from "react";
import { Check, GripVertical, Pencil, Plus, Settings2, Timer, Trash2, X } from "lucide-react";
import { InlineConfirm } from "../../components/InlineConfirm.jsx";
import {
  MANAGEMENT_ROW_ACTIONS_CLASS,
  MANAGEMENT_ROW_CLASS,
  ManagementIconAction,
} from "../../components/ManagementRow.jsx";
import { AddButton } from "../../components/AddButton.jsx";
import { TruncatingLabel } from "../../components/TruncatingLabel.jsx";
import { cn } from "../../lib/utils.js";
import { MODULE_REGISTRY } from "../../workspace/registry.jsx";
import { resolvePanelDisplayName } from "../../workspace/panelInstances.js";
import {
  DOCK_PANEL_MODULE_IDS,
  dockModuleIdForPanelModuleId,
  panelModuleIdForDockModuleId,
} from "../dockLayout.js";
import { DOCK_MODULE_REGISTRY } from "../registry.jsx";
import { DockEditorShell } from "./DockEditorShell.jsx";

const DOCK_ONLY_PANEL_META = {
  transport: {
    title: "Timecode",
    Icon: () => <Timer size={16} />,
  },
};

export function reorderDockModulesAtPointer(panelOrder, activeId, clientY, rect) {
  if (!rect || rect.height <= 0 || !panelOrder.length || !Number.isFinite(clientY)) {
    return panelOrder;
  }
  const from = panelOrder.indexOf(activeId);
  const rowHeight = rect.height / panelOrder.length;
  const to = Math.max(
    0,
    Math.min(panelOrder.length - 1, Math.floor((clientY - rect.top) / rowHeight))
  );
  if (from < 0 || from === to) return panelOrder;
  const next = [...panelOrder];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

function DockModuleRow({
  panel,
  title,
  dragging,
  onDragStart,
  onDragMove,
  onDragEnd,
  onRename,
  onRemove,
  onHover,
  onOpenSettings,
  vectorscopeSettingsAvailable,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const def = MODULE_REGISTRY[panel.moduleId] ?? DOCK_ONLY_PANEL_META[panel.moduleId];
  const dockEntry = DOCK_MODULE_REGISTRY[dockModuleIdForPanelModuleId(panel.moduleId)];

  const startRename = () => {
    setDraft(panel.customTitle ?? title);
    setEditing(true);
  };

  const commitRename = () => {
    onRename(panel.id, draft);
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
          // `size={1}`, not the default 20: keeps the input's intrinsic width from widening the
          // shrink-to-fit editor; `flex-1` fills the width the module rows already set.
          size={1}
          className="flex h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          autoFocus
        />
        <ManagementIconAction
          icon={<Check className="size-3.5" />}
          label={`Save ${title} name`}
          onClick={commitRename}
        />
        <ManagementIconAction
          icon={<X className="size-3.5" />}
          label={`Cancel ${title} rename`}
          onClick={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div
      data-testid={`dock-panel-row-${panel.id}`}
      className={cn(MANAGEMENT_ROW_CLASS, dragging && "z-10 ring-1 ring-primary/60")}
      onMouseEnter={() => onHover?.(panel.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <button
        type="button"
        aria-label={`Reorder ${title}`}
        onPointerDown={(event) => onDragStart(panel.id, event)}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        className="-ml-1 flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <GripVertical className="size-3.5" />
      </button>
      {def?.Icon ? (
        <span className="flex shrink-0 text-muted-foreground">
          <def.Icon />
        </span>
      ) : null}
      <TruncatingLabel text={title} className="min-w-0 flex-1 text-left text-foreground" />
      <span className={MANAGEMENT_ROW_ACTIONS_CLASS}>
        {dockEntry?.settingsFamily &&
        (panel.moduleId !== "vectorscope" || vectorscopeSettingsAvailable) ? (
          <ManagementIconAction
            icon={<Settings2 className="size-3.5" />}
            label={`${title} settings`}
            onClick={() => onOpenSettings(panel.id)}
          />
        ) : null}
        <ManagementIconAction
          icon={<Pencil className="size-3.5" />}
          label={`Rename ${title}`}
          onClick={startRename}
        />
        <InlineConfirm
          onConfirm={() => onRemove(panel.id)}
          confirmLabel={`Confirm delete ${title}`}
          cancelLabel={`Cancel delete ${title}`}
          trigger={(arm) => (
            <ManagementIconAction
              icon={<Trash2 className="size-3.5" />}
              label={`Delete ${title}`}
              onClick={arm}
              className="hover:text-destructive"
            />
          )}
        />
      </span>
    </div>
  );
}

function buildDisplayState(panels) {
  const panelsById = Object.fromEntries(panels.map((panel) => [panel.id, panel]));
  const panelOrder = panels.map((panel) => panel.id);
  return { panelsById, panelOrder };
}

function resolveDockPanelDisplayName(state, panelId) {
  const panel = state.panelsById[panelId];
  if (panel?.moduleId !== "transport") return resolvePanelDisplayName(state, panelId);

  const customTitle = String(panel.customTitle ?? "").trim();
  if (customTitle) return customTitle;

  const unnamedIds = state.panelOrder.filter((id) => {
    const candidate = state.panelsById[id];
    return candidate?.moduleId === "transport" && !String(candidate.customTitle ?? "").trim();
  });
  if (unnamedIds.length <= 1) return DOCK_ONLY_PANEL_META.transport.title;
  const index = unnamedIds.indexOf(panelId);
  return index >= 0
    ? `${DOCK_ONLY_PANEL_META.transport.title} ${index + 1}`
    : DOCK_ONLY_PANEL_META.transport.title;
}

export function DockModulesEditor({
  panels,
  modules,
  vectorscopeSettingsAvailable = false,
  onAdd,
  onRename,
  onRemove,
  onReorder,
  onHover,
  onOpenSettings,
}) {
  const panelList = useMemo(
    () =>
      panels ??
      (modules ?? []).map((moduleId) => ({
        id: moduleId,
        moduleId: panelModuleIdForDockModuleId(moduleId),
      })),
    [modules, panels]
  );
  const [orderedPanels, setOrderedPanels] = useState(panelList);
  const [adding, setAdding] = useState(false);
  const [draggingId, setDraggingId] = useState(null);
  const listRef = useRef(null);
  const orderedPanelIdsRef = useRef(panelList.map((panel) => panel.id));
  const dragStartOrderRef = useRef(panelList.map((panel) => panel.id));
  const draggingIdRef = useRef(null);
  const dragPointerRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      orderedPanelIdsRef.current = panelList.map((panel) => panel.id);
      setOrderedPanels(panelList);
    }, 0);
    return () => clearTimeout(timer);
  }, [panelList]);

  useEffect(() => () => onHover?.(null), [onHover]);

  const startDrag = (id, event) => {
    dragStartOrderRef.current = orderedPanelIdsRef.current;
    draggingIdRef.current = id;
    dragPointerRef.current = event.pointerId;
    setDraggingId(id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event) => {
    const activeId = draggingIdRef.current;
    if (!activeId || event.pointerId !== dragPointerRef.current) return;
    const rect = listRef.current?.getBoundingClientRect();
    const current = orderedPanelIdsRef.current;
    const next = reorderDockModulesAtPointer(current, activeId, event.clientY, rect);
    if (next === current) return;
    orderedPanelIdsRef.current = next;
    const byId = new Map(panelList.map((panel) => [panel.id, panel]));
    setOrderedPanels(next.map((panelId) => byId.get(panelId)).filter(Boolean));
  };

  const endDrag = (event) => {
    if (!draggingIdRef.current || event.pointerId !== dragPointerRef.current) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragPointerRef.current = null;
    draggingIdRef.current = null;
    setDraggingId(null);
    if (orderedPanelIdsRef.current.some((id, index) => dragStartOrderRef.current[index] !== id)) {
      onReorder(orderedPanelIdsRef.current);
    }
  };

  const displayState = buildDisplayState(orderedPanels);

  return (
    <DockEditorShell title="Modules">
      <div className="flex min-h-full flex-col p-1">
        {orderedPanels.length ? (
          <div
            ref={listRef}
            data-testid="dock-module-order-list"
            // `grid-cols-1` (= minmax(0,1fr)) constrains the column to the panel width; a bare grid
            // sizes its implicit auto column to the longest name and overflows the max-w cap, so the
            // row `truncate` never kicks in and a long module name bursts the panel.
            className="grid grid-cols-1 gap-px"
          >
            {orderedPanels.map((panel) => (
              <DockModuleRow
                key={panel.id}
                panel={panel}
                title={resolveDockPanelDisplayName(displayState, panel.id)}
                dragging={draggingId === panel.id}
                onDragStart={startDrag}
                onDragMove={moveDrag}
                onDragEnd={endDrag}
                onRename={onRename}
                onRemove={onRemove}
                onHover={onHover}
                onOpenSettings={onOpenSettings}
                vectorscopeSettingsAvailable={vectorscopeSettingsAvailable}
              />
            ))}
          </div>
        ) : (
          <p className="px-2 py-3 text-xs text-muted-foreground">No modules</p>
        )}

        <div className="mt-1 border-t border-border/30 pt-1">
          {adding ? (
            <div className="grid grid-cols-1 gap-px pb-1">
              {DOCK_PANEL_MODULE_IDS.map((id) => {
                const entry = MODULE_REGISTRY[id] ?? DOCK_ONLY_PANEL_META[id];
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onAdd(id)}
                    className={cn(
                      MANAGEMENT_ROW_CLASS,
                      "text-left text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    )}
                  >
                    <span className="flex shrink-0 text-muted-foreground">
                      {entry?.Icon ? <entry.Icon /> : <Plus className="size-3.5" />}
                    </span>
                    <span className="truncate">{entry?.title ?? id}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <AddButton
            label="Add Module"
            aria-expanded={adding}
            onClick={() => setAdding((current) => !current)}
          />
        </div>
      </div>
    </DockEditorShell>
  );
}
