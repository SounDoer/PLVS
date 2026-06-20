# Custom Themes — Plan 2: Floating Editor, Color Control, Draft Semantics, Settings UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user duplicate the active theme into a named custom theme and edit its seed + shell colors in a floating, draggable panel with a live full-app preview (draft/save/cancel), and select/delete custom themes from Settings.

**Architecture:** A `useThemeEditor` hook owns the draft state machine and live-applies the draft by overlaying it into the `customThemes` map passed to `applyThemeToDocument`. A `ColorControl` (swatch + popover with native picker + hex + alpha) edits any field; `colorIO` converts between CSS color strings (hex/rgba/oklch) and `{hex, alpha}`. A `ThemeEditor` floating panel renders the fields and Save/Cancel/Delete; `dragClamp` keeps it in-window. Settings gains custom entries + New/Edit/Delete and hides while editing.

**Tech Stack:** JavaScript (ESM), React 19, Vitest. Builds on Plan 1 (model/repo/registry/engine).

**Spec:** `docs/working/superpowers/specs/2026-06-20-custom-themes-design.md` (§6 editor UX, §3 decisions).

**Roadmap:** Plan 2 of 2. Plan 1 (foundation) is on this branch. After Plan 2, custom themes are fully user-creatable/editable.

---

### Task 1: `colorIO` — CSS color string ↔ `{hex, alpha}`

**Files:**
- Create: `src/theme/colorIO.js`
- Test: `src/theme/colorIO.test.js`

The color control speaks hex + alpha (0–1); theme values may be hex, `rgba(...)`, or `oklch(...)`.
`toEditable` parses any to `{hex, alpha}` (reusing the existing oklch string parser); `fromEditable`
emits hex when alpha≈1 else `rgba(...)`.

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from "vitest";
import { toEditable, fromEditable } from "./colorIO.js";

describe("colorIO", () => {
  it("parses hex", () => {
    expect(toEditable("#fb923c")).toEqual({ hex: "#fb923c", alpha: 1 });
  });
  it("parses rgba", () => {
    expect(toEditable("rgba(255,255,255,0.04)")).toEqual({ hex: "#ffffff", alpha: 0.04 });
  });
  it("parses oklch (incl alpha)", () => {
    const e = toEditable("oklch(1 0 0 / 9%)");
    expect(e.hex.toLowerCase()).toBe("#ffffff");
    expect(e.alpha).toBeCloseTo(0.09, 2);
  });
  it("round-trips: opaque -> hex, translucent -> rgba", () => {
    expect(fromEditable("#fb923c", 1)).toBe("#fb923c");
    expect(fromEditable("#ffffff", 0.04)).toBe("rgba(255, 255, 255, 0.04)");
  });
  it("falls back to a safe default for unparseable input", () => {
    expect(toEditable("nonsense").hex).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `src/theme/colorIO.js`**

```javascript
import { oklchToHex } from "./shadcnSemanticPreset.js"; // string oklch(...) -> hex/rgba

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/** @param {string} value @returns {{hex:string, alpha:number}} */
export function toEditable(value) {
  const v = typeof value === "string" ? value.trim() : "";
  // hex #rrggbb
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return { hex: `#${m[1].toLowerCase()}`, alpha: 1 };
  // rgb/rgba
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (m) {
    const hx = (n) => Number(n).toString(16).padStart(2, "0");
    return {
      hex: `#${hx(m[1])}${hx(m[2])}${hx(m[3])}`,
      alpha: m[4] == null ? 1 : clamp01(parseFloat(m[4])),
    };
  }
  // oklch(...) — reuse the existing string parser, which returns hex or rgba(...)
  if (v.startsWith("oklch(")) {
    const out = oklchToHex(v);
    if (out.startsWith("#")) return { hex: out, alpha: 1 };
    return toEditable(out); // oklchToHex returned rgba(...) for the alpha case
  }
  return { hex: "#808080", alpha: 1 };
}

/** @param {string} hex @param {number} alpha @returns {string} */
export function fromEditable(hex, alpha) {
  if (alpha >= 0.999) return hex;
  const n = parseInt(hex.slice(1), 16);
  const a = Math.round(clamp01(alpha) * 1000) / 1000;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/theme/colorIO.js src/theme/colorIO.test.js
git commit -m "feat(theme): add colorIO between CSS color strings and {hex, alpha}"
```

---

### Task 2: `dragClamp` — keep a panel within the window

**Files:**
- Create: `src/lib/dragClamp.js`
- Test: `src/lib/dragClamp.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from "vitest";
import { clampPanelPos } from "./dragClamp.js";

describe("clampPanelPos", () => {
  const win = { w: 1000, h: 800 };
  const panel = { w: 320, h: 400 };
  it("keeps a fully-inside position unchanged", () => {
    expect(clampPanelPos({ x: 100, y: 100 }, panel, win)).toEqual({ x: 100, y: 100 });
  });
  it("clamps past the right/bottom edges", () => {
    expect(clampPanelPos({ x: 900, y: 700 }, panel, win)).toEqual({ x: 680, y: 400 });
  });
  it("clamps negative to zero", () => {
    expect(clampPanelPos({ x: -50, y: -10 }, panel, win)).toEqual({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `src/lib/dragClamp.js`**

```javascript
/**
 * @param {{x:number,y:number}} pos
 * @param {{w:number,h:number}} panel
 * @param {{w:number,h:number}} win
 * @returns {{x:number,y:number}}
 */
export function clampPanelPos(pos, panel, win) {
  return {
    x: Math.max(0, Math.min(pos.x, win.w - panel.w)),
    y: Math.max(0, Math.min(pos.y, win.h - panel.h)),
  };
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/dragClamp.js src/lib/dragClamp.test.js
git commit -m "feat(ui): add clampPanelPos for in-window floating panels"
```

---

### Task 3: `useThemeEditor` — draft state machine

**Files:**
- Create: `src/hooks/useThemeEditor.js`
- Test: `src/hooks/useThemeEditor.test.js`

The hook applies the draft live by overlaying it into `customThemes` and calling the injected `apply`
(default `applyThemeToDocument`). It is given the current selection setters so create/cancel can move
selection. `apply` is injectable for headless testing.

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { themesStore } from "../persistence/index.js";
import { BUILTIN_THEMES } from "../theme/builtinThemes.js";
import { listCustomThemes } from "../theme/customThemesRepo.js";
import { useThemeEditor } from "./useThemeEditor.js";

beforeEach(() => themesStore.reset());

function setup(apply) {
  const selection = { appearance: "fixed", themeId: "plvs-dark" };
  const setThemeId = vi.fn((id) => (selection.themeId = id));
  const setAppearance = vi.fn((a) => (selection.appearance = a));
  return renderHook(() =>
    useThemeEditor({
      activeTheme: BUILTIN_THEMES["plvs-dark"],
      customThemes: listCustomThemes(),
      prevSelection: { appearance: "fixed", themeId: "plvs-dark" },
      setThemeId,
      setAppearance,
      apply,
      makeId: () => "custom-1",
    })
  );
}

describe("useThemeEditor", () => {
  it("beginCreate duplicates the active theme, persists, selects, and applies the draft", () => {
    const apply = vi.fn();
    const { result } = setup(apply);
    act(() => result.current.beginCreate("Sunset"));
    expect(result.current.isEditing).toBe(true);
    expect(result.current.draft.name).toBe("Sunset");
    expect(listCustomThemes()["custom-1"]).toBeTruthy();
    // applied with the draft overlaid into the map
    const [id, map] = apply.mock.calls.at(-1);
    expect(id).toBe("custom-1");
    expect(map["custom-1"].name).toBe("Sunset");
  });

  it("updateSeed/updateShell mutate the draft and re-apply", () => {
    const apply = vi.fn();
    const { result } = setup(apply);
    act(() => result.current.beginCreate("S"));
    act(() => result.current.updateSeed("accent", "#22d3ee"));
    expect(result.current.draft.seeds.accent).toBe("#22d3ee");
    act(() => result.current.updateShell("background", "#101010"));
    expect(result.current.draft.semantic.background).toBe("#101010");
    expect(apply.mock.calls.at(-1)[1]["custom-1"].semantic.background).toBe("#101010");
  });

  it("save persists the final draft and ends editing", () => {
    const apply = vi.fn();
    const { result } = setup(apply);
    act(() => result.current.beginCreate("S"));
    act(() => result.current.updateSeed("accent", "#22d3ee"));
    act(() => result.current.save());
    expect(result.current.isEditing).toBe(false);
    expect(listCustomThemes()["custom-1"].seeds.accent).toBe("#22d3ee");
  });

  it("cancel of a newly-created theme removes it and restores previous selection", () => {
    const apply = vi.fn();
    const { result } = setup(apply);
    act(() => result.current.beginCreate("S"));
    act(() => result.current.cancel());
    expect(result.current.isEditing).toBe(false);
    expect(listCustomThemes()["custom-1"]).toBeUndefined();
    // re-applied the previous theme without the draft overlay
    expect(apply.mock.calls.at(-1)[0]).toBe("plvs-dark");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `src/hooks/useThemeEditor.js`**

```javascript
import { useCallback, useRef, useState } from "react";
import { applyThemeToDocument } from "../uiPreferences";
import { makeCustomThemeFromBase } from "../theme/customTheme.js";
import { listCustomThemes, upsertCustomTheme, removeCustomTheme } from "../theme/customThemesRepo.js";

/**
 * @param {{
 *   activeTheme: object,
 *   customThemes: Record<string, object>,
 *   prevSelection: { appearance: string, themeId: string|null },
 *   setThemeId: (id: string) => void,
 *   setAppearance: (a: string) => void,
 *   apply?: (id: string, customThemes: Record<string, object>) => void,
 *   makeId?: () => string,
 * }} opts
 */
export function useThemeEditor(opts) {
  const apply = opts.apply ?? applyThemeToDocument;
  const [draft, setDraft] = useState(/** @type {object|null} */ (null));
  const wasNewRef = useRef(false);
  const prevRef = useRef(opts.prevSelection);

  const applyDraft = useCallback(
    (next) => apply(next.id, { ...listCustomThemes(), [next.id]: next }),
    [apply]
  );

  const beginEdit = useCallback(
    (theme) => {
      wasNewRef.current = false;
      prevRef.current = { appearance: "fixed", themeId: theme.id };
      const d = structuredClone(theme);
      setDraft(d);
      applyDraft(d);
    },
    [applyDraft]
  );

  const beginCreate = useCallback(
    (name) => {
      wasNewRef.current = true;
      prevRef.current = opts.prevSelection;
      const d = makeCustomThemeFromBase(opts.activeTheme, name, opts.makeId);
      upsertCustomTheme(d);
      opts.setAppearance("fixed");
      opts.setThemeId(d.id);
      setDraft(d);
      applyDraft(d);
    },
    [opts, applyDraft]
  );

  const setName = useCallback((name) => {
    setDraft((d) => (d ? { ...d, name: String(name) } : d));
  }, []);

  const updateSeed = useCallback(
    (key, value) => {
      setDraft((d) => {
        if (!d) return d;
        const next =
          key === "good" || key === "warn" || key === "bad"
            ? { ...d, seeds: { ...d.seeds, signal: { ...d.seeds.signal, [key]: value } } }
            : { ...d, seeds: { ...d.seeds, [key]: value } };
        applyDraft(next);
        return next;
      });
    },
    [applyDraft]
  );

  const updateShell = useCallback(
    (key, value) => {
      setDraft((d) => {
        if (!d) return d;
        const next = { ...d, semantic: { ...d.semantic, [key]: value } };
        applyDraft(next);
        return next;
      });
    },
    [applyDraft]
  );

  const save = useCallback(() => {
    setDraft((d) => {
      if (d) upsertCustomTheme(d);
      return null;
    });
  }, []);

  const cancel = useCallback(() => {
    setDraft((d) => {
      if (d && wasNewRef.current) removeCustomTheme(d.id);
      const prev = prevRef.current;
      opts.setAppearance(prev.appearance);
      opts.setThemeId(prev.themeId);
      apply(
        prev.appearance === "fixed" ? prev.themeId : "plvs-dark",
        listCustomThemes()
      );
      return null;
    });
  }, [opts, apply]);

  return {
    isEditing: draft != null,
    draft,
    beginCreate,
    beginEdit,
    setName,
    updateSeed,
    updateShell,
    save,
    cancel,
  };
}
```

- [ ] **Step 4: Run, expect PASS.** (Uses `@testing-library/react`'s `renderHook` — already a dev dep
  since the project tests hooks. If not present, install it as a dev dependency.)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useThemeEditor.js src/hooks/useThemeEditor.test.js
git commit -m "feat(theme): add useThemeEditor draft state machine"
```

---

### Task 4: `ColorControl` component

**Files:**
- Create: `src/components/ColorControl.jsx`
- Test: `src/components/ColorControl.test.jsx`

Swatch button opening a popover with a native color input, a hex text input, and an alpha range.
Emits a CSS color string via `onChange`.

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColorControl } from "./ColorControl.jsx";

describe("ColorControl", () => {
  it("shows the current color and emits hex at full alpha", () => {
    const onChange = vi.fn();
    render(<ColorControl label="Accent" value="#fb923c" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /accent/i }));
    fireEvent.input(screen.getByLabelText(/hex/i), { target: { value: "#22d3ee" } });
    expect(onChange).toHaveBeenLastCalledWith("#22d3ee");
  });
  it("emits rgba when alpha < 1", () => {
    const onChange = vi.fn();
    render(<ColorControl label="Border" value="#ffffff" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /border/i }));
    fireEvent.input(screen.getByLabelText(/alpha/i), { target: { value: "0.5" } });
    expect(onChange).toHaveBeenLastCalledWith("rgba(255, 255, 255, 0.5)");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `src/components/ColorControl.jsx`**

```jsx
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { toEditable, fromEditable } from "../theme/colorIO.js";

/**
 * @param {{ label: string, value: string, onChange: (css: string) => void }} props
 */
export function ColorControl({ label, value, onChange }) {
  const edit = toEditable(value);
  const [hex, setHex] = useState(edit.hex);
  const [alpha, setAlpha] = useState(edit.alpha);

  function emit(nextHex, nextAlpha) {
    setHex(nextHex);
    setAlpha(nextAlpha);
    onChange(fromEditable(nextHex, nextAlpha));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex items-center gap-2 text-left"
        >
          <span
            className="h-5 w-5 rounded border border-border"
            style={{ backgroundColor: value }}
          />
          <span className="text-[length:var(--ui-fs-metric-meta)]">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="flex w-56 flex-col gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={hex}
          onInput={(e) => emit(e.target.value, alpha)}
        />
        <div className="flex items-center gap-2">
          <Label htmlFor={`${label}-hex`}>Hex</Label>
          <input
            id={`${label}-hex`}
            aria-label={`${label} hex`}
            value={hex}
            onInput={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && emit(e.target.value, alpha)}
            className="flex-1 rounded border border-input bg-transparent px-2 py-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${label}-alpha`}>Alpha</Label>
          <input
            id={`${label}-alpha`}
            aria-label={`${label} alpha`}
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={alpha}
            onInput={(e) => emit(hex, parseFloat(e.target.value))}
            className="flex-1"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run, expect PASS.** (If the popover content does not mount in jsdom until opened,
  the test already clicks the trigger first; if Radix popover needs it, wrap with the existing test
  setup other component tests use.)

- [ ] **Step 5: Commit**

```bash
git add src/components/ColorControl.jsx src/components/ColorControl.test.jsx
git commit -m "feat(ui): add ColorControl swatch + hex + alpha picker"
```

---

### Task 5: `ThemeEditor` floating draggable panel

**Files:**
- Create: `src/components/ThemeEditor.jsx`

This is presentational + drag. It renders nothing when not editing. Props come from `useThemeEditor`
plus position persistence. Match existing component styling conventions (Card-like surface, the
`--ui-*` tokens) the way the rest of `src/components` does.

- [ ] **Step 1: Implement `src/components/ThemeEditor.jsx`**

```jsx
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ColorControl } from "./ColorControl.jsx";
import { clampPanelPos } from "../lib/dragClamp.js";

const SHELL_GROUPS = [
  { title: "Surface", keys: ["background", "card", "popover", "secondary", "muted", "accent"] },
  { title: "Text", keys: ["foreground", "cardForeground", "popoverForeground", "mutedForeground", "secondaryForeground", "accentForeground"] },
  { title: "Brand", keys: ["primary", "primaryForeground", "ring", "destructive", "destructiveForeground"] },
  { title: "Lines", keys: ["border", "input"] },
];

/**
 * @param {{
 *   draft: object,
 *   onName: (s: string) => void,
 *   onSeed: (key: string, css: string) => void,
 *   onShell: (key: string, css: string) => void,
 *   onSave: () => void,
 *   onCancel: () => void,
 *   onDelete?: () => void,
 *   pos: {x:number,y:number},
 *   onMove: (p: {x:number,y:number}) => void,
 * }} props
 */
export function ThemeEditor({ draft, onName, onSeed, onShell, onSave, onCancel, onDelete, pos, onMove }) {
  const ref = useRef(null);
  const dragRef = useRef(null);

  function onPointerDown(e) {
    const rect = ref.current.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    onMove(
      clampPanelPos(
        { x: e.clientX - d.dx, y: e.clientY - d.dy },
        { w: d.w, h: d.h },
        { w: window.innerWidth, h: window.innerHeight }
      )
    );
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Theme editor"
      className="fixed z-50 flex max-h-[80vh] w-80 flex-col gap-2 overflow-hidden rounded-[var(--ui-radius-modal)] border border-border bg-card text-card-foreground shadow-lg"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex cursor-move items-center justify-between border-b border-border px-3 py-2"
      >
        <input
          aria-label="Theme name"
          value={draft.name}
          onInput={(e) => onName(e.target.value)}
          className="bg-transparent text-[length:var(--ui-fs-panel-title)] font-semibold"
        />
        <span className="text-[length:var(--ui-fs-status)] text-muted-foreground">{draft.colorScheme}</span>
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto px-3 py-2">
        <section className="flex flex-col gap-1.5">
          <Label>Seeds</Label>
          <ColorControl label="Accent" value={draft.seeds.accent} onChange={(c) => onSeed("accent", c)} />
          <ColorControl label="Accent 2" value={draft.seeds.accentSecondary} onChange={(c) => onSeed("accentSecondary", c)} />
          <ColorControl label="Signal Good" value={draft.seeds.signal.good} onChange={(c) => onSeed("good", c)} />
          <ColorControl label="Signal Warn" value={draft.seeds.signal.warn} onChange={(c) => onSeed("warn", c)} />
          <ColorControl label="Signal Bad" value={draft.seeds.signal.bad} onChange={(c) => onSeed("bad", c)} />
        </section>
        {SHELL_GROUPS.map((g) => (
          <section key={g.title} className="flex flex-col gap-1.5">
            <Label>{g.title}</Label>
            {g.keys.map((k) => (
              <ColorControl key={k} label={k} value={draft.semantic[k]} onChange={(c) => onShell(k, c)} />
            ))}
          </section>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        {onDelete ? (
          <Button variant="ghost" onClick={onDelete} className="text-destructive">Delete</Button>
        ) : <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={onSave}>Save</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Lint check**

Run: `npx eslint src/components/ThemeEditor.jsx`
Expected: no errors. (No test for the drag interaction itself — `clampPanelPos` is unit-tested in
Task 2.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ThemeEditor.jsx
git commit -m "feat(ui): add floating draggable ThemeEditor panel"
```

---

### Task 6: Wire editor + actions into `useSettings`

**Files:**
- Modify: `src/hooks/useSettings.js`

Expose the editor, the ordered custom options, selection routing, and create/delete actions. Persist
the editor position.

- [ ] **Step 1: Add wiring**

Add imports:

```javascript
import { listCustomThemesOrdered, removeCustomTheme } from "../theme/customThemesRepo.js";
import { getTheme } from "../theme/themeRegistry.js";
import { useThemeEditor } from "./useThemeEditor.js";
import { isCustomThemeId } from "../theme/customTheme.js";
```

Add state + editor + actions inside `useSettings` (after `customThemes` from Plan 1):

```javascript
  const [editorPos, setEditorPos] = useState(
    () => settingsStore.read().themeEditorPos ?? { x: 80, y: 80 }
  );
  function moveEditor(pos) {
    setEditorPos(pos);
    settingsStore.patch({ themeEditorPos: pos });
  }

  const editor = useThemeEditor({
    activeTheme: getTheme(resolvedThemeId, customThemes),
    customThemes,
    prevSelection: { appearance, themeId },
    setThemeId,
    setAppearance,
  });

  const customThemeOptions = useMemo(
    () => listCustomThemesOrdered().map((t) => ({ id: t.id, label: t.name })),
    [customThemes]
  );

  function selectThemeId(id) {
    setAppearance("fixed");
    setThemeId(id);
  }
  function createCustomTheme() {
    setSettingsOpen(false);
    editor.beginCreate(`${getTheme(resolvedThemeId, customThemes).label ?? "Theme"} copy`);
  }
  function editActiveCustomTheme() {
    if (!isCustomThemeId(resolvedThemeId)) return;
    setSettingsOpen(false);
    editor.beginEdit(getTheme(resolvedThemeId, customThemes));
  }
  function deleteCustomTheme(id) {
    removeCustomTheme(id);
    setCustomThemes(listCustomThemes());
    if (themeId === id) selectThemeId("plvs-dark");
  }
```

Replace `setFixedThemeIdFromPicker` body so it accepts custom ids:

```javascript
  function setFixedThemeIdFromPicker(id) {
    if (!isKnownThemeId(id, customThemes)) return;
    setAppearance("fixed");
    setThemeId(id);
  }
```

Add to the returned object: `editor`, `editorPos`, `moveEditor`, `customThemeOptions`,
`createCustomTheme`, `editActiveCustomTheme`, `deleteCustomTheme`, and a convenience
`activeIsCustom: isCustomThemeId(resolvedThemeId)`.

- [ ] **Step 2: Verify**

Run: `npx vitest run src/hooks`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSettings.js
git commit -m "feat(theme): expose custom-theme editor and CRUD actions from useSettings"
```

---

### Task 7: Settings picker entries + buttons; mount the editor

**Files:**
- Modify: `src/components/SettingsPanel.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Settings — list customs + New/Edit/Delete**

In `src/components/SettingsPanel.jsx`, the `appearance === "fixed"` block's `<Select>` currently maps
only `themeSelectOptions` (builtins). Add a custom group and action buttons. Use the new props from
`useSettings` (thread them through the existing `SettingsPanel` prop list): `customThemeOptions`,
`createCustomTheme`, `editActiveCustomTheme`, `deleteCustomTheme`, `activeIsCustom`,
`fixedThemeSelectValue`, `setFixedThemeIdFromPicker`.

Inside `<SelectContent>` after the builtin items, append:

```jsx
{customThemeOptions.map((opt) => (
  <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
))}
```

After the `<Select>`, add an action row:

```jsx
<div className="flex items-center gap-2">
  <Button size="sm" variant="ghost" onClick={createCustomTheme}>Duplicate</Button>
  {activeIsCustom ? (
    <>
      <Button size="sm" variant="ghost" onClick={editActiveCustomTheme}>Edit</Button>
      <Button size="sm" variant="ghost" className="text-destructive"
        onClick={() => deleteCustomTheme(fixedThemeSelectValue)}>Delete</Button>
    </>
  ) : null}
</div>
```

- [ ] **Step 2: App — mount the floating editor**

In `src/App.jsx`, destructure the new fields from `useSettings` (where `SettingsPanel` props are
gathered ~line 145–169), pass the Settings ones into `<SettingsPanel ... />`, and mount the editor
next to it (~line 1289):

```jsx
{settings.editor.isEditing ? (
  <ThemeEditor
    draft={settings.editor.draft}
    onName={settings.editor.setName}
    onSeed={settings.editor.updateSeed}
    onShell={settings.editor.updateShell}
    onSave={settings.editor.save}
    onCancel={settings.editor.cancel}
    onDelete={settings.activeIsCustom ? () => settings.editor.cancel() /* see note */ : undefined}
    pos={settings.editorPos}
    onMove={settings.moveEditor}
  />
) : null}
```

Add `import { ThemeEditor } from "./components/ThemeEditor";` at the top. NOTE on Delete-in-editor:
deleting while editing should remove the theme and close — implement `onDelete` as a small handler in
`App`/`useSettings` that calls `deleteCustomTheme(draft.id)` then `editor.cancel()`-style teardown
without re-saving; if that proves fiddly, omit the in-editor Delete (Settings already has Delete) and
pass `onDelete={undefined}`.

(Use whatever variable name `useSettings()` is assigned to in `App.jsx` — shown here as `settings`.)

- [ ] **Step 3: Lint + targeted tests**

Run: `npx eslint src/components/SettingsPanel.jsx src/App.jsx` and `npx vitest run src/components`
Expected: no eslint errors; component tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/SettingsPanel.jsx src/App.jsx
git commit -m "feat(theme): add custom themes to Settings picker and mount the editor"
```

---

### Task 8: Full verification + manual smoke

- [ ] **Step 1: Full check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 2: Manual smoke**

Launch the app → Settings → Appearance: Fixed → **Duplicate**. The Settings sheet hides and the
floating editor appears. Drag it by its title bar to a corner (it stays in-window). Edit **Accent** —
the whole UI (buttons, loudness/spectrum traces) recolors live. Edit a **shell** color (e.g.
background). Rename to "Smoke". **Save** → editor closes, app shows the custom theme; reopen Settings
and confirm "Smoke" is selected in the picker. **Duplicate** again, change a color, **Cancel** → the
new theme is discarded and the prior theme returns. Select a custom theme, **Delete** → falls back to
Dark. Quit and relaunch with a custom theme active → it reapplies (with a brief default-dark first
paint, as expected).

- [ ] **Step 3: Commit any formatting auto-fixes**

```bash
git add -A && git commit -m "chore(theme): formatting after custom theme editor" || echo "nothing to commit"
```

---

## Self-Review

- **Spec coverage:** §6.1 entry points = Duplicate(active)/Edit/Delete (Tasks 6–7); §6.2 floating
  draggable, clamped, position-persisted panel (Tasks 2, 5, 6); §6.3 alpha-capable color control
  (Tasks 1, 4); §6.4 draft/save/cancel incl. create-cancel-discards (Task 3); hide-Settings-on-edit
  (Task 6 `setSettingsOpen(false)`); close→return-to-app (editor unmount, no reopen). Invariant
  "edit = active theme" enforced (beginEdit/createCustomTheme use `getTheme(resolvedThemeId,…)`).
- **Out of scope (slice C):** colormap editing, community import, system-mode mapping, colorScheme
  flip — none added.
- **Placeholder scan:** the only soft spot is the in-editor Delete handler (Task 7 Step 2), which has
  an explicit concrete fallback (omit it; Settings provides Delete) — not a blocking placeholder.
- **Type consistency:** `useThemeEditor` returns `{ isEditing, draft, beginCreate, beginEdit, setName,
  updateSeed, updateShell, save, cancel }` (Task 3) — consumed verbatim in Tasks 6–7. `ColorControl`
  `{label,value,onChange}` and `ThemeEditor` props match their call sites. `colorIO` `toEditable`/
  `fromEditable` and `clampPanelPos` signatures match their importers.
