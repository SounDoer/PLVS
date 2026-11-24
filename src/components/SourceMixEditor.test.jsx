/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { BlockingEditorsProvider, useBlockingEditors } from "../hooks/BlockingEditorsContext.jsx";
import { useSourceMixes } from "../hooks/useSourceMixes.js";
import { UiNavigationProvider, useUiNavigation } from "../uiNavigation/UiNavigationContext.jsx";
import { SCENE_OPERATIONS } from "../lib/sceneOperations.js";
import { sourceMixesStore } from "../persistence/index.js";
import { SourceMixEditor } from "./SourceMixEditor.jsx";

vi.mock("../persistence/index.js", () => ({
  sourceMixesStore: { read: vi.fn(), persist: vi.fn(), subscribe: vi.fn(() => () => {}) },
}));

const applications = [
  { id: `app-${"1".repeat(32)}`, label: "Player" },
  { id: `app-${"2".repeat(32)}`, label: "DAW" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sourceMixesStore.read).mockReturnValue({ list: [] });
  vi.mocked(sourceMixesStore.persist).mockResolvedValue(undefined);
});

function mountEditor(onSelect = vi.fn(), inputs = []) {
  let registry;
  let navigation;
  function Harness() {
    const owner = useSourceMixes({ supported: true, onSelect, onError: vi.fn() });
    registry = useBlockingEditors();
    navigation = useUiNavigation();
    return owner.draft ? (
      <SourceMixEditor owner={owner} applications={applications} inputs={inputs} />
    ) : (
      <button onClick={() => owner.open()}>Add Mix</button>
    );
  }
  render(
    <BlockingEditorsProvider>
      <UiNavigationProvider getRevision={() => 3}>
        <Harness />
      </UiNavigationProvider>
    </BlockingEditorsProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Add Mix" }));
  return { onSelect, scene: () => registry, ui: () => navigation };
}

it("exposes edit choices with generation checks and keeps the draft name out of inspection", async () => {
  const { ui } = mountEditor();
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Applications" }));
  const initial = ui().inspectUi();
  const editor = initial.surfaces.find(({ kind }) => kind === "sourceMixEditor");
  expect(editor.target).toEqual({ intent: "create" });
  expect(editor.choices.find(({ id }) => id === "save").disabled).toBe(true);
  const decide = (choice, generation) =>
    ui().decideSurface({
      surfaceId: editor.surfaceId,
      choice,
      expectedRevision: 3,
      expectedUiGeneration: generation,
    });
  await act(async () => {
    await decide(`toggle:${applications[0].id}`, initial.uiGeneration);
  });
  await expect(decide(`toggle:${applications[1].id}`, initial.uiGeneration)).rejects.toMatchObject({
    reason: "uiGenerationConflict",
  });
  await act(async () => {
    await decide(`toggle:${applications[1].id}`, ui().inspectUi().uiGeneration);
  });
  expect(
    ui()
      .inspectUi()
      .surfaces[0].choices.find(({ id }) => id === "save").disabled
  ).toBeUndefined();
  expect(sourceMixesStore.persist).not.toHaveBeenCalled();
  await act(async () => {
    await decide("cancel", ui().inspectUi().uiGeneration);
  });
  expect(ui().inspectUi().surfaces).toHaveLength(0);
});

it("saves one application with one input and its chosen channel through Agent Control", async () => {
  const cable = { id: `cap-${"3".repeat(32)}`, label: "Cable", channels: 2 };
  const mic = { id: `cap-${"4".repeat(32)}`, label: "Microphone", channels: 1 };
  const { ui } = mountEditor(vi.fn(), [mic, cable]);
  const decide = async (choice) => {
    const state = ui().inspectUi();
    await act(async () => {
      await ui().decideSurface({
        surfaceId: state.surfaces[0].surfaceId,
        choice,
        expectedRevision: 3,
        expectedUiGeneration: state.uiGeneration,
      });
    });
  };
  await decide("group:input");
  await decide(`input:${mic.id}`);
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  await decide("input-toggle:0");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
  await decide(`input:${cable.id}`);
  expect(screen.getByRole("button", { name: "Microphone 1 Selected" })).toHaveProperty(
    "type",
    "button"
  );
  expect(screen.getByRole("checkbox", { name: "Channel 1" })).toHaveProperty("checked", false);
  await decide("input-toggle:1");
  expect(screen.getByRole("button", { name: "Microphone" }).textContent).not.toContain("Selected");
  await decide("group:applications");
  await decide(`toggle:${applications[0].id}`);
  await decide("save");
  expect(vi.mocked(sourceMixesStore.persist).mock.calls[0][0].list[0]).toMatchObject({
    members: [applications[0]],
    input: { id: cable.id, label: cable.label, channels: [1] },
  });
});

it("blocks scene mutation from an open draft and discards it on Cancel", () => {
  const { onSelect, scene } = mountEditor();
  fireEvent.click(screen.getByRole("button", { name: "Applications" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Player" }));
  const mutateScene = vi.fn();
  expect(() => {
    scene().assertSceneOperationAllowed(SCENE_OPERATIONS.presetApply);
    mutateScene();
  }).toThrow();
  expect(mutateScene).not.toHaveBeenCalled();
  expect(sourceMixesStore.persist).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(scene().activeBlockingEditors).toEqual([]);
  expect(onSelect).not.toHaveBeenCalled();
});

it("requires two members and selects the named Mix only after saving it", async () => {
  let finishSave;
  vi.mocked(sourceMixesStore.persist).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      })
  );
  const { onSelect } = mountEditor();
  const save = screen.getByRole("button", { name: "Save" });
  fireEvent.click(screen.getByRole("button", { name: "Applications" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Player" }));
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "DAW" }));
  fireEvent.click(screen.getByRole("button", { name: "rename mix" }));
  fireEvent.change(screen.getByRole("textbox", { name: "mix name" }), {
    target: { value: "My Mix" },
  });
  fireEvent.click(save);
  expect(onSelect).not.toHaveBeenCalled();
  const mix = vi.mocked(sourceMixesStore.persist).mock.calls[0][0].list[0];
  expect(mix).toMatchObject({ name: "My Mix", members: applications });
  await act(async () => finishSave());
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith(mix.id));
});

it.each([{ channels: [0] }, { channels: [0, 2] }])(
  "saves only the checked input channels without an application ($channels)",
  async ({ channels }) => {
    const input = { id: `cap-${"3".repeat(32)}`, label: "Interface", channels: 3 };
    const { ui } = mountEditor(vi.fn(), [input]);
    const decide = async (choice) => {
      const state = ui().inspectUi();
      await act(async () => {
        await ui().decideSurface({
          surfaceId: state.surfaces[0].surfaceId,
          choice,
          expectedRevision: 3,
          expectedUiGeneration: state.uiGeneration,
        });
      });
    };
    await decide("group:input");
    await decide(`input:${input.id}`);
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    for (const channel of channels) await decide(`input-toggle:${channel}`);
    await decide("save");
    expect(vi.mocked(sourceMixesStore.persist).mock.calls[0][0].list[0]).toMatchObject({
      members: [],
      input: { id: input.id, channels },
    });
  }
);
