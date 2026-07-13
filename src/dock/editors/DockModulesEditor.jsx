import { useEffect, useMemo, useRef, useState } from "react";
import { Check, GripVertical, Pencil, Plus, Settings2, Timer, Trash2, X } from "lucide-react";
import { InlineConfirm } from "../../components/InlineConfirm.jsx";
import { IconButton } from "../../components/IconButton.jsx";
import { Button } from "../../components/ui/button.jsx";
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
  onOpenSettings,
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
      <div className="flex h-9 w-full items-center gap-1 rounded-md px-1.5 py-1">
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
        <IconButton
          icon={<Check className="size-3.5" />}
          tip={`Save ${title} name`}
          onClick={commitRename}
        />
        <IconButton
          icon={<X className="size-3.5" />}
          tip={`Cancel ${title} rename`}
          onClick={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div
      data-testid={`dock-panel-row-${panel.id}`}
      className={`group grid h-9 grid-cols-[28px_18px_minmax(0,1fr)_28px_28px_28px] items-center rounded-md px-1 text-xs transition-colors hover:bg-muted/50 ${dragging ? "z-10 ring-1 ring-primary/60" : ""}`}
    >
      <button
        type="button"
        aria-label={`Reorder ${title}`}
        onPointerDown={(event) => onDragStart(panel.id, event)}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        className="flex size-7 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" />
      </button>
      {def?.Icon ? (
        <span className="flex shrink-0 text-muted-foreground">
          <def.Icon />
        </span>
      ) : null}
      <span className="min-w-0 truncate px-1 text-left text-foreground">{title}</span>
      {dockEntry?.settingsFamily ? (
        <IconButton
          icon={<Settings2 className="size-3.5" />}
          tip={`${title} settings`}
          onClick={() => onOpenSettings(panel.id)}
        />
      ) : (
        <span />
      )}
      <IconButton
        icon={<Pencil className="size-3.5" />}
        tip={`Rename ${title}`}
        onClick={startRename}
      />
      <InlineConfirm
        onConfirm={() => onRemove(panel.id)}
        confirmLabel={`Confirm delete ${title}`}
        cancelLabel={`Cancel delete ${title}`}
        trigger={(arm) => (
          <IconButton
            icon={<Trash2 className="size-3.5" />}
            tip={`Delete ${title}`}
            onClick={arm}
            className="hover:text-destructive"
          />
        )}
      />
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
  onAdd,
  onRename,
  onRemove,
  onReorder,
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
      <div className="flex min-h-full flex-col p-1.5">
        {orderedPanels.length ? (
          <div ref={listRef} data-testid="dock-module-order-list" className="grid gap-px">
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
                onOpenSettings={onOpenSettings}
              />
            ))}
          </div>
        ) : (
          <p className="px-2 py-3 text-xs text-muted-foreground">No modules</p>
        )}

        <div className="mt-1 border-t border-border/30 pt-1">
          {adding ? (
            <div className="grid gap-px pb-1">
              {DOCK_PANEL_MODULE_IDS.map((id) => {
                const entry = MODULE_REGISTRY[id] ?? DOCK_ONLY_PANEL_META[id];
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onAdd(id)}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-foreground hover:bg-secondary/50"
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={adding}
            onClick={() => setAdding((current) => !current)}
            className="h-7 w-full px-2 text-xs"
          >
            <Plus className="size-3.5" />
            Add Module
          </Button>
        </div>
      </div>
    </DockEditorShell>
  );
}
