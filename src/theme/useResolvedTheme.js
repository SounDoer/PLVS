import { useSyncExternalStore } from "react";

import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";
import { compileTheme } from "./compileTheme.js";
import { themeRuntime } from "./themeRuntime.js";

const FALLBACK_RESOLVED_THEME = compileTheme(BUILTIN_THEMES_V2["plvs-dark"]);
const subscribe = (listener) => themeRuntime.subscribe((resolved) => resolved, listener);
const getSnapshot = () => themeRuntime.getSnapshot() ?? FALLBACK_RESOLVED_THEME;

export function useResolvedTheme(selector = (resolved) => resolved) {
  const resolved = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return selector(resolved);
}
