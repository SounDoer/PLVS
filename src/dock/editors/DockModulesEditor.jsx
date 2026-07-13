import { useEffect, useRef, useState } from "react";
import { GripVertical, Plus, Settings2, Trash2 } from "lucide-react";
import { IconButton } from "../../components/IconButton.jsx";
import { Button } from "../../components/ui/button.jsx";
import { DOCK_MODULE_IDS } from "../dockLayout.js";
import { DOCK_MODULE_REGISTRY } from "../registry.jsx";
import { DockEditorShell } from "./DockEditorShell.jsx";

export function reorderDockModulesAtPointer(modules, activeId, clientY, rect) {
  if (!rect || rect.height <= 0 || !modules.length || !Number.isFinite(clientY)) return modules;
  const from = modules.indexOf(activeId);
  const rowHeight = rect.height / modules.length;
  const to = Math.max(
    0,
    Math.min(modules.length - 1, Math.floor((clientY - rect.top) / rowHeight))
  );
  if (from < 0 || from === to) return modules;
  const next = [...modules];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

function DockModuleRow({
  id,
  dragging,
  onDragStart,
  onDragMove,
  onDragEnd,
  onRemove,
  onOpenSettings,
}) {
  const entry = DOCK_MODULE_REGISTRY[id];

  return (
    <div
      data-testid={`dock-module-row-${id}`}
      className={`grid h-9 grid-cols-[28px_minmax(0,1fr)_28px_28px] items-center rounded-md bg-secondary/25 px-1 shadow-sm ${dragging ? "z-10 ring-1 ring-primary/60" : ""}`}
    >
      <button
        type="button"
        aria-label={`Reorder ${entry.label}`}
        onPointerDown={(event) => onDragStart(id, event)}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        className="flex size-7 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" />
      </button>
      <span className="truncate px-1 text-xs font-medium">{entry.label}</span>
      {entry.settingsFamily ? (
        <IconButton
          icon={<Settings2 className="size-3.5" />}
          tip={`${entry.label} settings`}
          onClick={() => onOpenSettings(id)}
        />
      ) : (
        <span />
      )}
      <IconButton
        icon={<Trash2 className="size-3.5" />}
        tip={`Remove ${entry.label}`}
        onClick={() => onRemove(id)}
        className="hover:text-destructive"
      />
    </div>
  );
}

export function DockModulesEditor({ modules, onAdd, onRemove, onReorder, onOpenSettings, onDone }) {
  const [orderedModules, setOrderedModules] = useState(modules);
  const [adding, setAdding] = useState(false);
  const [draggingId, setDraggingId] = useState(null);
  const listRef = useRef(null);
  const orderedModulesRef = useRef(modules);
  const dragStartOrderRef = useRef(modules);
  const draggingIdRef = useRef(null);
  const dragPointerRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      orderedModulesRef.current = modules;
      setOrderedModules(modules);
    }, 0);
    return () => clearTimeout(timer);
  }, [modules]);

  const startDrag = (id, event) => {
    dragStartOrderRef.current = orderedModulesRef.current;
    draggingIdRef.current = id;
    dragPointerRef.current = event.pointerId;
    setDraggingId(id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event) => {
    const activeId = draggingIdRef.current;
    if (!activeId || event.pointerId !== dragPointerRef.current) return;
    const rect = listRef.current?.getBoundingClientRect();
    const current = orderedModulesRef.current;
    const next = reorderDockModulesAtPointer(current, activeId, event.clientY, rect);
    if (next === current) return;
    orderedModulesRef.current = next;
    setOrderedModules(next);
  };

  const endDrag = (event) => {
    if (!draggingIdRef.current || event.pointerId !== dragPointerRef.current) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragPointerRef.current = null;
    draggingIdRef.current = null;
    setDraggingId(null);
    if (orderedModulesRef.current.some((id, index) => dragStartOrderRef.current[index] !== id)) {
      onReorder(orderedModulesRef.current);
    }
  };

  const availableModules = DOCK_MODULE_IDS.filter((id) => !orderedModules.includes(id));

  return (
    <DockEditorShell title="Modules" onDone={onDone}>
      <div className="flex min-h-full flex-col p-1.5">
        {orderedModules.length ? (
          <div ref={listRef} data-testid="dock-module-order-list" className="grid gap-px">
            {orderedModules.map((id) => (
              <DockModuleRow
                key={id}
                id={id}
                dragging={draggingId === id}
                onDragStart={startDrag}
                onDragMove={moveDrag}
                onDragEnd={endDrag}
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
              {availableModules.length ? (
                availableModules.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onAdd(id)}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-foreground hover:bg-secondary/50"
                  >
                    <Plus className="size-3.5 text-muted-foreground" />
                    <span className="truncate">{DOCK_MODULE_REGISTRY[id].label}</span>
                  </button>
                ))
              ) : (
                <p className="px-2 py-2 text-xs text-muted-foreground">All modules added</p>
              )}
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
