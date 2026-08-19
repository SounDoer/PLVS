/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { themesStore } from "../persistence/index.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { listCustomThemeDocuments } from "../theme/customThemesRepo.js";
import { useThemeEditor } from "./useThemeEditor.js";

beforeEach(() => themesStore.reset());

function setup(publish, onChange = vi.fn()) {
  const selection = { appearance: "fixed", themeId: "plvs-dark" };
  const setThemeId = vi.fn((id) => (selection.themeId = id));
  const setAppearance = vi.fn((a) => (selection.appearance = a));
  const rendered = renderHook(() =>
    useThemeEditor({
      activeTheme: BUILTIN_THEMES_V2["plvs-dark"],
      setThemeId,
      setAppearance,
      publish,
      onChange,
      makeId: () => "custom-1",
    })
  );
  return Object.assign(rendered, { onChange, setAppearance, setThemeId });
}

describe("useThemeEditor", () => {
  it("beginCreate publishes an unsaved draft without changing persistence or selection", () => {
    const publish = vi.fn();
    const { result, setAppearance, setThemeId } = setup(publish);
    act(() => result.current.beginCreate("Sunset"));
    expect(result.current.isEditing).toBe(true);
    expect(result.current.draft.name).toBe("Sunset");
    expect(listCustomThemeDocuments()["custom-1"]).toBeUndefined();
    expect(setAppearance).not.toHaveBeenCalled();
    expect(setThemeId).not.toHaveBeenCalled();
    expect(publish.mock.calls.at(-1)[0]).toMatchObject({ id: "custom-1", name: "Sunset" });
  });

  it("draft operations mutate and re-publish Theme V2 without persisting", () => {
    const publish = vi.fn();
    const { result } = setup(publish);
    act(() => result.current.beginCreate("S"));
    act(() => result.current.updateCore("interfaceAccent", "#22d3ee"));
    expect(result.current.draft.core.interfaceAccent).toBe("#22d3ee");
    expect(publish.mock.calls.at(-1)[0].core.interfaceAccent).toBe("#22d3ee");
    expect(listCustomThemeDocuments()).toEqual({});
  });

  it("edits palette anchors and applies owned preset snapshots", () => {
    const publish = vi.fn();
    const { result } = setup(publish);
    act(() => result.current.beginCreate("S"));

    act(() => result.current.updatePaletteColor("status", "warning", "#abcdef"));
    expect(result.current.draft.palettes.status).toMatchObject({
      presetId: null,
      warning: "#abcdef",
    });

    act(() => result.current.applyPreset("frequency", "frequency-cool"));
    expect(result.current.draft.palettes.frequency).toMatchObject({
      presetId: "frequency-cool",
      low: "#a855f7",
      mid: "#06b6d4",
      high: "#60a5fa",
    });
    expect(listCustomThemeDocuments()).toEqual({});
  });

  it("save persists the final draft and ends editing", () => {
    const publish = vi.fn();
    const { result, setAppearance, setThemeId } = setup(publish);
    act(() => result.current.beginCreate("S"));
    act(() => result.current.updateCore("interfaceAccent", "#22d3ee"));
    act(() => result.current.save());
    expect(result.current.isEditing).toBe(false);
    expect(listCustomThemeDocuments()["custom-1"].core.interfaceAccent).toBe("#22d3ee");
    expect(setAppearance).toHaveBeenCalledWith("fixed");
    expect(setThemeId).toHaveBeenCalledWith("custom-1");
  });

  it("notifies onChange after store mutations so consumers can refresh listings", () => {
    const onChange = vi.fn();
    const { result } = setup(vi.fn(), onChange);
    act(() => result.current.beginCreate("S"));
    expect(onChange).not.toHaveBeenCalled();
    act(() => result.current.save());
    expect(onChange).toHaveBeenCalledTimes(1);

    const onChange2 = vi.fn();
    const { result: r2 } = setup(vi.fn(), onChange2);
    act(() => r2.current.beginCreate("S2"));
    act(() => r2.current.cancel());
    expect(onChange2).not.toHaveBeenCalled();
  });

  it("cancel drops the draft and republishes the original theme without a store mutation", () => {
    const publish = vi.fn();
    const { result } = setup(publish);
    act(() => result.current.beginCreate("S"));
    act(() => result.current.cancel());
    expect(result.current.isEditing).toBe(false);
    expect(listCustomThemeDocuments()["custom-1"]).toBeUndefined();
    expect(publish.mock.calls.at(-1)[0].id).toBe("plvs-dark");
  });
});
