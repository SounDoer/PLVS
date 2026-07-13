import { useEffect } from "react";
import { useAccessoryClient } from "./useAccessoryClient.js";
import { DockModulesEditor } from "../editors/DockModulesEditor.jsx";
import { DockModuleSettings } from "../editors/DockModuleSettings.jsx";
import { DockPresetsRow } from "../editors/DockPresetsRow.jsx";

export function DockEditorApp() {
  const { payload, action, pointer } = useAccessoryClient("dock-editor");
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") action("close-editor");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [action]);
  if (!payload) return null;
  const close = () => action("close-editor");
  const presetController = {
    ...payload.presets,
    apply: (presetId) => action("apply-preset", { presetId }),
    save: (name) => action("save-preset", { name }),
    update: (presetId) => action("update-preset", { presetId }),
    rename: (presetId, name) => action("rename-preset", { presetId, name }),
    remove: (presetId) => action("delete-preset", { presetId }),
  };
  const moduleId = payload.view?.startsWith("module:") ? payload.view.slice(7) : null;
  return (
    <div
      data-testid="dock-editor"
      onPointerEnter={() => pointer(true)}
      onPointerLeave={() => pointer(false)}
      className="h-full w-full overflow-hidden border border-border/70 bg-background/95 text-foreground shadow-lg backdrop-blur-sm"
    >
      {payload.view === "modules" ? (
        <DockModulesEditor
          modules={payload.modules}
          onAdd={(moduleId) => action("add-module", { moduleId })}
          onRemove={(moduleId) => action("remove-module", { moduleId })}
          onReorder={(modules) => action("reorder-module", { modules })}
          onOpenSettings={(moduleId) => action("open-module-settings", { moduleId })}
          onDone={close}
        />
      ) : payload.view === "presets" ? (
        <DockPresetsRow presets={presetController} onDone={close} />
      ) : moduleId ? (
        <DockModuleSettings
          moduleId={moduleId}
          controls={payload.controlsByModuleId[moduleId]}
          onChange={(controls) => action("update-module-controls", { moduleId, controls })}
          onReset={() => action("reset-module-controls", { moduleId })}
          onBack={() => action("open-editor", { view: "modules" })}
          onDone={close}
        />
      ) : null}
    </div>
  );
}
