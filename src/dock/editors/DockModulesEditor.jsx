import { useRef } from "react";
import { GripVertical, Settings2 } from "lucide-react";
import { Switch } from "../../components/ui/switch.jsx";
import { IconButton } from "../../components/IconButton.jsx";
import { DOCK_MODULE_IDS } from "../dockLayout.js";
import { DOCK_MODULE_REGISTRY } from "../registry.jsx";
import { DockEditorShell } from "./DockEditorShell.jsx";
import { cn } from "@/lib/utils";

export function DockModulesEditor({ modules, onToggle, onReorder, onOpenSettings, onDone }) {
  const dragFromRef = useRef(null);
  const orderedIds = [
    ...modules,
    ...DOCK_MODULE_IDS.filter((moduleId) => !modules.includes(moduleId)),
  ];

  return (
    <DockEditorShell title="Modules" onDone={onDone}>
      <div className="grid gap-px p-1.5">
        {orderedIds.map((id) => {
          const entry = DOCK_MODULE_REGISTRY[id];
          const enabled = modules.includes(id);
          const enabledIndex = modules.indexOf(id);
          return (
            <div
              key={id}
              data-testid={`dock-module-row-${id}`}
              draggable={enabled}
              onDragStart={() => {
                dragFromRef.current = enabledIndex;
              }}
              onDragEnd={() => {
                dragFromRef.current = null;
              }}
              onDragOver={(event) => {
                if (enabled && dragFromRef.current !== null) event.preventDefault();
              }}
              onDrop={() => {
                if (enabled && dragFromRef.current !== null) {
                  onReorder(dragFromRef.current, enabledIndex);
                }
                dragFromRef.current = null;
              }}
              className={cn(
                "grid h-9 grid-cols-[24px_minmax(0,1fr)_28px_32px] items-center rounded-md px-1",
                enabled ? "bg-secondary/25" : "text-muted-foreground"
              )}
            >
              <GripVertical
                aria-hidden="true"
                className={cn("size-3.5", enabled ? "cursor-grab" : "opacity-25")}
              />
              <span className="truncate text-xs font-medium">{entry.label}</span>
              {entry.settingsFamily ? (
                <IconButton
                  icon={<Settings2 className="size-3.5" />}
                  tip={`${entry.label} settings`}
                  onClick={() => onOpenSettings(id)}
                />
              ) : (
                <span />
              )}
              <Switch
                aria-label={`${entry.label} module`}
                checked={enabled}
                onCheckedChange={() => onToggle(id)}
                className="h-4 w-7 justify-self-end"
                thumbClassName="size-3 data-[state=checked]:translate-x-3"
              />
            </div>
          );
        })}
      </div>
    </DockEditorShell>
  );
}
