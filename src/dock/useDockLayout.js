import { useCallback, useState } from "react";
import { workspaceStore } from "../persistence/index.js";
import { normalizeDockLayout, reorderDockModule, toggleDockModule } from "./dockLayout.js";

export function useDockLayout() {
  const [layout, setLayout] = useState(() => normalizeDockLayout(workspaceStore.read().dock));

  const write = useCallback((next) => {
    workspaceStore.patch({ dock: next });
    setLayout(next);
  }, []);

  const toggle = useCallback(
    (id) => write(toggleDockModule(normalizeDockLayout(workspaceStore.read().dock), id)),
    [write]
  );
  const reorder = useCallback(
    (from, to) =>
      write(reorderDockModule(normalizeDockLayout(workspaceStore.read().dock), from, to)),
    [write]
  );
  const setModules = useCallback((modules) => write(normalizeDockLayout({ modules })), [write]);

  return { modules: layout.modules, toggle, reorder, setModules };
}
