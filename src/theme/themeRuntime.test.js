/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

import { BUILTIN_THEMES } from "./builtinThemes.js";
import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";
import { makeCustomThemeFromBase } from "./customTheme.js";
import {
  applyResolvedThemeToDocument,
  createThemeRuntime,
  selectColorScheme,
} from "./themeRuntime.js";

afterEach(() => {
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeRevision;
});

describe("themeRuntime", () => {
  it("publishes immutable monotonically revisioned snapshots", () => {
    const apply = vi.fn();
    const runtime = createThemeRuntime({ apply });
    const first = runtime.publishAuthoring(BUILTIN_THEMES_V2["plvs-dark"]);
    const changed = structuredClone(BUILTIN_THEMES_V2["plvs-dark"]);
    changed.core.primaryData = "#123456";
    const second = runtime.publishAuthoring(changed);

    expect(first.id).toBe(second.id);
    expect([first.revision, second.revision]).toEqual([1, 2]);
    expect(second.css["--ui-spectrum-primary"]).toBe("#123456");
    expect(Object.isFrozen(second.roles)).toBe(true);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("does not notify a narrow scheme subscriber for irrelevant color changes", () => {
    const runtime = createThemeRuntime({ apply: () => {} });
    const listener = vi.fn();
    runtime.subscribe(selectColorScheme, listener);
    runtime.publishAuthoring(BUILTIN_THEMES_V2["plvs-dark"]);
    const changed = structuredClone(BUILTIN_THEMES_V2["plvs-dark"]);
    changed.core.primaryData = "#123456";
    runtime.publishAuthoring(changed);
    runtime.publishAuthoring(BUILTIN_THEMES_V2["plvs-light"]);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.map(([scheme]) => scheme)).toEqual(["dark", "light"]);
  });

  it("accepts a legacy custom draft only at the authoring ingress", () => {
    const runtime = createThemeRuntime({ apply: () => {} });
    const custom = makeCustomThemeFromBase(BUILTIN_THEMES["plvs-light"], "Old", () => "custom-old");
    const resolved = runtime.publishSelection(custom.id, { [custom.id]: custom });
    expect(resolved.id).toBe("custom-old");
    expect(resolved.colorScheme).toBe("light");
    expect(resolved.roles["core.interfaceAccent"]).toBe("#e07020");
  });

  it("falls back to Dark for an unknown selection", () => {
    const runtime = createThemeRuntime({ apply: () => {} });
    expect(runtime.publishSelection("missing").id).toBe("plvs-dark");
  });

  it("publishes CSS and root metadata from one resolved revision", () => {
    const runtime = createThemeRuntime({ apply: applyResolvedThemeToDocument });
    const resolved = runtime.publishSelection("plvs-light");
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("plvs-light");
    expect(root.dataset.themeRevision).toBe(String(resolved.revision));
    expect(root.style.getPropertyValue("color-scheme")).toBe("light");
    expect(root.style.getPropertyValue("--ui-spectrum-primary")).toBe("#e07020");
  });
});
