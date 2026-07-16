/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { themesStore } from "../persistence/index.js";
import { BUILTIN_THEMES } from "../theme/builtinThemes.js";
import { listCustomThemes } from "../theme/customThemesRepo.js";
import { useThemeEditor } from "./useThemeEditor.js";

beforeEach(() => themesStore.reset());

function setup(apply, onChange = vi.fn()) {
  const selection = { appearance: "fixed", themeId: "plvs-dark" };
  const setThemeId = vi.fn((id) => (selection.themeId = id));
  const setAppearance = vi.fn((a) => (selection.appearance = a));
  const rendered = renderHook(() =>
    useThemeEditor({
      activeTheme: BUILTIN_THEMES["plvs-dark"],
      customThemes: listCustomThemes(),
      prevSelection: { appearance: "fixed", themeId: "plvs-dark" },
      setThemeId,
      setAppearance,
      apply,
      onChange,
      makeId: () => "custom-1",
    })
  );
  return Object.assign(rendered, { onChange });
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

  it("notifies onChange after store mutations so consumers can refresh listings", () => {
    const onChange = vi.fn();
    const { result } = setup(vi.fn(), onChange);
    act(() => result.current.beginCreate("S"));
    expect(onChange).toHaveBeenCalledTimes(1);
    act(() => result.current.save());
    expect(onChange).toHaveBeenCalledTimes(2);

    const onChange2 = vi.fn();
    const { result: r2 } = setup(vi.fn(), onChange2);
    act(() => r2.current.beginCreate("S2"));
    act(() => r2.current.cancel());
    expect(onChange2).toHaveBeenCalledTimes(2); // create + cancel(remove)
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
