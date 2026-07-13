import { useEffect, useRef, useState } from "react";
import { DockControls } from "./DockControls.jsx";
import { DockModulesEditor } from "./editors/DockModulesEditor.jsx";
import { DockPresetsRow } from "./editors/DockPresetsRow.jsx";
import { DOCK_MODULE_REGISTRY } from "./registry.jsx";
import { cn } from "@/lib/utils";

const HIDE_DELAY_MS = 300;

function healthFromNotice(notice) {
  if (!notice) return "ok";
  return notice.kind === "error" ? "error" : "warn";
}

/** The docked strip: modules row + hover controls + in-strip editors. */
export function DockStrip({
  modules,
  onToggleModule,
  onReorderModule,
  statsIds,
  onToggleStat,
  controls,
  presets,
}) {
  const [hovered, setHovered] = useState(false);
  const [view, setView] = useState("meters"); // meters | modules | presets
  const hideTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(hideTimerRef.current), []);

  const onPointerEnter = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setHovered(true);
  };
  const onPointerLeave = () => {
    hideTimerRef.current = setTimeout(() => setHovered(false), HIDE_DELAY_MS);
  };

  const health = healthFromNotice(controls.notice);

  return (
    <div
      data-testid="dock-strip"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="relative h-screen w-screen select-none overflow-hidden text-foreground"
      style={{
        // Spec: dock shares the Views Opacity value. App.jsx keeps setting
        // --panel-opacity in both forms; the window itself is transparent.
        background: "color-mix(in srgb, var(--background) var(--panel-opacity, 100%), transparent)",
      }}
    >
      {view === "meters" ? (
        <div className="flex h-full min-w-0 items-stretch divide-x divide-border/40">
          {modules.map((id) => {
            const entry = DOCK_MODULE_REGISTRY[id];
            if (!entry) return null;
            const { Component } = entry;
            return (
              <div
                key={id}
                data-testid="dock-module"
                className={cn("min-w-0", entry.flexible ? "flex-1" : "shrink-0")}
              >
                <Component controls={controls} />
              </div>
            );
          })}
        </div>
      ) : view === "modules" ? (
        <DockModulesEditor
          modules={modules}
          statsIds={statsIds}
          onToggle={onToggleModule}
          onToggleStat={onToggleStat}
          onReorder={onReorderModule}
          onDone={() => setView("meters")}
        />
      ) : (
        <DockPresetsRow presets={presets} onDone={() => setView("meters")} />
      )}

      {hovered && view === "meters" ? (
        <DockControls
          {...controls}
          onEditModules={() => setView("modules")}
          onEditPresets={() => setView("presets")}
        />
      ) : null}

      <div
        data-testid="dock-health-dot"
        data-health={health}
        aria-hidden="true"
        className="absolute bottom-1 right-1 z-30 size-1.5 rounded-full"
        style={{
          background:
            health === "error"
              ? "var(--ui-signal-bad)"
              : health === "warn"
                ? "var(--ui-signal-warn)"
                : "color-mix(in srgb, var(--ui-signal-good) 35%, transparent)",
        }}
      />
    </div>
  );
}
