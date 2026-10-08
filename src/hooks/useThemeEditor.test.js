/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { themesStore } from "../persistence/index.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { makeCustomThemeV2FromBase } from "../theme/customTheme.js";
import { listCustomThemeDocuments } from "../theme/customThemesRepo.js";
import { useThemeEditor } from "./useThemeEditor.js";

beforeEach(() => themesStore.reset());

function setup(publish, onChange = vi.fn(), onSave = vi.fn(() => true)) {
  const rendered = renderHook(() =>
    useThemeEditor({
      activeTheme: BUILTIN_THEMES_V2["plvs-dark"],
      onSave,
      publish,
      onChange,
      makeId: () => "custom-1",
    })
  );
  return Object.assign(rendered, { onChange, onSave });
}

describe("useThemeEditor", () => {
  it("beginCreate publishes an unsaved draft without changing persistence or selection", () => {
    const publish = vi.fn();
    const { result, onSave } = setup(publish);
    act(() => result.current.beginCreate("Sunset"));
    expect(result.current.isEditing).toBe(true);
    expect(result.current.draft.name).toBe("Sunset");
    expect(listCustomThemeDocuments()["custom-1"]).toBeUndefined();
    expect(onSave).not.toHaveBeenCalled();
    expect(publish.mock.calls.at(-1)[0]).toMatchObject({ id: "custom-1", name: "Sunset" });
  });

  it("draft operations mutate and re-publish Theme V2 without persisting", async () => {
    const publish = vi.fn();
    const { result } = setup(publish);
    act(() => result.current.beginCreate("S"));
    act(() => result.current.updateCore("interfaceAccent", "#22d3ee"));
    expect(result.current.draft.core.interfaceAccent).toBe("#22d3ee");
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(publish.mock.calls.at(-1)[0].core.interfaceAccent).toBe("#22d3ee");
    expect(listCustomThemeDocuments()).toEqual({});
  });

  it("versions each changed semantic draft transaction without treating it as persistence", () => {
    const { result } = setup(vi.fn());

    act(() => result.current.beginCreate("S"));
    expect(result.current.draftGeneration).toBe(0);

    act(() => result.current.updateCore("workspace", "#111111"));
    expect(result.current.draftGeneration).toBe(1);

    act(() => result.current.updateCore("workspace", "#111111"));
    expect(result.current.draftGeneration).toBe(1);
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

    act(() => result.current.applyPreset("frequency", "frequency-plvs"));
    expect(result.current.draft.palettes.frequency).toMatchObject({
      presetId: "frequency-plvs",
      low: "#ff2d3d",
      mid: "#fb923c",
      high: "#356dff",
    });
    expect(listCustomThemeDocuments()).toEqual({});
  });

  it("restores the same canonical Inferno stops after selecting another intensity preset", () => {
    const publish = vi.fn();
    const { result } = setup(publish);
    act(() => result.current.beginCreate("S"));
    const original = structuredClone(result.current.draft.palettes.intensity.stops);

    act(() => result.current.applyPreset("intensity", "intensity-viridis"));
    act(() => result.current.applyPreset("intensity", "intensity-inferno"));

    expect(result.current.draft.palettes.intensity.stops).toEqual(original);
    expect(result.current.draft.palettes.intensity.stops).toHaveLength(11);
  });

  it("changes Appearance and resets an Advanced section as one draft operation", () => {
    const publish = vi.fn();
    const { result } = setup(publish);
    act(() => result.current.beginCreate("S"));

    act(() => result.current.updateColorScheme("light"));
    expect(result.current.draft.colorScheme).toBe("light");

    act(() => result.current.updateOverride("waveform.trace", { kind: "color", value: "#123456" }));
    act(() =>
      result.current.updateOverride("waveform.snapshot", { kind: "color", value: "#654321" })
    );
    act(() => result.current.resetOverrides(["waveform.trace", "waveform.snapshot"]));
    expect(result.current.draft.overrides).not.toHaveProperty("waveform.trace");
    expect(result.current.draft.overrides).not.toHaveProperty("waveform.snapshot");
  });

  it("resets the whole Core to the current Appearance defaults as one undoable edit", () => {
    const publish = vi.fn();
    const { result } = setup(publish);
    act(() => result.current.beginCreate("S"));
    act(() => result.current.updateColorScheme("light"));

    const beforeReset = structuredClone(result.current.draft.core);
    act(() => result.current.resetCore());
    expect(result.current.draft.core).toEqual(BUILTIN_THEMES_V2["plvs-light"].core);

    act(() => result.current.undo());
    expect(result.current.draft.core).toEqual(beforeReset);
    expect(result.current.draft.colorScheme).toBe("light");
  });

  it("undoes and redoes coalesced changes without writing persistence", () => {
    const publish = vi.fn();
    const { result } = setup(publish);
    act(() => result.current.beginCreate("S"));
    const original = result.current.draft.core.workspace;

    act(() => result.current.updateCore("workspace", "#111111"));
    act(() => result.current.updateCore("workspace", "#222222"));
    expect(result.current.draftGeneration).toBe(2);
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.draftGeneration).toBe(3);
    expect(result.current.draft.core.workspace).toBe(original);
    expect(result.current.dirty).toBe(false);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.draftGeneration).toBe(4);
    expect(result.current.draft.core.workspace).toBe("#222222");
    expect(listCustomThemeDocuments()).toEqual({});
  });

  it("save delegates the final draft to the controller and ends editing", () => {
    const publish = vi.fn();
    const { result, onSave } = setup(publish);
    act(() => result.current.beginCreate("S"));
    act(() => result.current.updateCore("interfaceAccent", "#22d3ee"));
    act(() => result.current.save());
    expect(result.current.isEditing).toBe(false);
    expect(listCustomThemeDocuments()["custom-1"]).toBeUndefined();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "custom-1",
        core: expect.objectContaining({ interfaceAccent: "#22d3ee" }),
      }),
      { isNew: true, stale: false }
    );
  });

  it("keeps an open draft and marks it stale when its Library source changes", () => {
    const publish = vi.fn();
    const { result } = setup(publish);
    const source = makeCustomThemeV2FromBase(
      BUILTIN_THEMES_V2["plvs-dark"],
      "Shared",
      () => "custom-shared"
    );
    act(() => result.current.beginEdit(source));
    act(() => result.current.updateCore("workspace", "#222222"));
    const localDraft = structuredClone(result.current.draft);

    act(() => result.current.syncSource({ ...source, name: "Changed elsewhere" }));

    expect(result.current.stale).toBe(true);
    expect(result.current.draft).toEqual(localDraft);
  });

  it("keeps the editor open when the controller refuses Save", () => {
    const onSave = vi.fn(() => false);
    const { result } = setup(vi.fn(), vi.fn(), onSave);
    act(() => result.current.beginCreate("S"));
    act(() => result.current.save());
    expect(result.current.isEditing).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
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

  it("owns authoring origin, page navigation, and safe dismissal", () => {
    const publish = vi.fn();
    const { result } = setup(publish);
    act(() =>
      result.current.beginCreate("Light Custom", BUILTIN_THEMES_V2["plvs-light"], {
        mode: "customize",
        sourceId: "plvs-light",
      })
    );

    expect(result.current.authoring).toEqual({
      mode: "customize",
      sourceId: "plvs-light",
      draftId: "custom-1",
    });
    expect(result.current.page).toBe("core");
    act(() => result.current.setPage("advanced"));
    expect(result.current.page).toBe("advanced");

    act(() => result.current.updateCore("workspace", "#111111"));
    act(() => result.current.requestDismiss());
    expect(result.current.isEditing).toBe(true);
    expect(result.current.discardOpen).toBe(true);

    act(() => result.current.keepEditing());
    expect(result.current.discardOpen).toBe(false);
    act(() => result.current.requestDismiss());
    act(() => result.current.confirmDiscard());
    expect(result.current.isEditing).toBe(false);
    expect(publish.mock.calls.at(-1)[0].id).toBe("plvs-dark");
  });

  it("dismisses a clean draft directly through the shared intent", () => {
    const { result } = setup(vi.fn());
    act(() => result.current.beginCreate("Clean"));
    act(() => result.current.requestDismiss());
    expect(result.current.isEditing).toBe(false);
    expect(result.current.discardOpen).toBe(false);
  });
});
