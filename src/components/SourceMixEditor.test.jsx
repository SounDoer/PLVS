/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { BlockingEditorsProvider, useBlockingEditors } from "../hooks/BlockingEditorsContext.jsx";
import { useSourceMixes } from "../hooks/useSourceMixes.js";
import { UiNavigationProvider, useUiNavigation } from "../uiNavigation/UiNavigationContext.jsx";
import { SCENE_OPERATIONS } from "../lib/sceneOperations.js";
import { sourceMixesStore } from "../persistence/index.js";
import { SourceMixEditor } from "./SourceMixEditor.jsx";
import {
  EditorDraftProvider,
  useEditorDraftRegistry,
} from "../agentControl/EditorDraftContext.jsx";
import { planEditorDraftPatch } from "../agentControl/editorDraftControl.js";
import { publicMixDocument } from "../agentControl/mixDraftControl.js";

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

function mountEditor(onSelect = vi.fn(), inputs = [], outputs = []) {
  let registry;
  let navigation;
  let draftControl;
  function Harness() {
    const owner = useSourceMixes({ supported: true, onSelect, onError: vi.fn() });
    registry = useBlockingEditors();
    navigation = useUiNavigation();
    draftControl = useEditorDraftRegistry();
    return owner.draft ? (
      <SourceMixEditor
        owner={owner}
        applications={applications}
        inputs={inputs}
        outputs={outputs}
      />
    ) : (
      <button onClick={() => owner.open()}>Add Mix</button>
    );
  }
  render(
    <BlockingEditorsProvider>
      <UiNavigationProvider getRevision={() => 3}>
        <EditorDraftProvider>
          <Harness />
        </EditorDraftProvider>
      </UiNavigationProvider>
    </BlockingEditorsProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Add Mix" }));
  return { onSelect, scene: () => registry, ui: () => navigation, drafts: () => draftControl };
}

it("patches a complete named Mix with exact gains atomically and saves through the editor", async () => {
  const input = { id: `cap-${"3".repeat(32)}`, label: "Microphone", channels: 2 };
  const { ui, drafts, onSelect } = mountEditor(vi.fn(), [input]);
  const { surfaceId } = ui().inspectUi().surfaces[0];
  const before = drafts().inspect("mix", surfaceId);
  const operations = [
    { op: "setName", name: "My Mix" },
    { op: "setRoute", sourceId: input.id, lane: "0", destinations: [{ role: "Ls", gainDb: -2.5 }] },
    { op: "setFormat", format: "5.1" },
    { op: "setInputChannels", sourceId: input.id, channels: [0] },
  ];
  const invalid = planEditorDraftPatch(
    "mix",
    before.document,
    {
      operations: [
        ...operations,
        { op: "setRoute", sourceId: input.id, lane: "1", destinations: [] },
      ],
    },
    before.inventory
  );
  expect(invalid.changed).toBe(false);
  expect(invalid.document).toBe(before.document);
  const patch = planEditorDraftPatch("mix", before.document, { operations }, before.inventory);
  expect(patch.issues).toEqual([]);
  act(() => drafts().commit("mix", surfaceId, patch.document));
  const after = drafts().inspect("mix", surfaceId);
  expect(after.draftGeneration).toBeGreaterThan(before.draftGeneration);
  expect(after.dirty).toBe(true);
  expect(publicMixDocument(after.document)).toMatchObject({
    name: "My Mix",
    format: "5.1",
    routes: { [input.id]: { 0: [{ role: "Ls", gainDb: -2.5 }] } },
  });
  expect(sourceMixesStore.persist).not.toHaveBeenCalled();
  expect(() => drafts().save("mix", surfaceId, before.draftGeneration)).toThrow(
    "draftGenerationConflict"
  );
  await act(async () => {
    const saved = await drafts().save("mix", surfaceId, after.draftGeneration);
    expect(onSelect).toHaveBeenCalledWith(saved.savedId);
  });
  expect(sourceMixesStore.persist).toHaveBeenCalledOnce();
  expect(ui().inspectUi().surfaces).toHaveLength(0);
});

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

it("keeps checked channels from two input devices and saves them with an application", async () => {
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
  expect(screen.getByRole("button", { name: "Microphone 1 Selected" })).toHaveProperty(
    "type",
    "button"
  );
  await decide("group:applications");
  await decide(`toggle:${applications[0].id}`);
  await decide("save");
  expect(vi.mocked(sourceMixesStore.persist).mock.calls[0][0].list[0]).toMatchObject({
    members: [applications[0]],
    inputs: [
      { id: mic.id, channels: [0] },
      { id: cable.id, label: cable.label, channels: [1] },
    ],
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

it("saves a single application and selects the named Mix after persistence", async () => {
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
  expect(save).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Player" }));
  expect(save).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByRole("button", { name: "rename mix" }));
  fireEvent.change(screen.getByRole("textbox", { name: "mix name" }), {
    target: { value: "My Mix" },
  });
  fireEvent.click(save);
  expect(onSelect).not.toHaveBeenCalled();
  const mix = vi.mocked(sourceMixesStore.persist).mock.calls[0][0].list[0];
  expect(mix).toMatchObject({ name: "My Mix", members: [applications[0]] });
  expect(mix.input).toBeUndefined();
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
      inputs: [{ id: input.id, channels }],
    });
  }
);

it("retains selections on conflict and saves a stereo output with input channels", async () => {
  const input = { id: `cap-${"3".repeat(32)}`, label: "Interface", channels: 2 };
  const output = { id: `lb-${"4".repeat(32)}`, label: "Speakers", mixStereoOutput: true };
  const surround = { id: `lb-${"5".repeat(32)}`, label: "Surround" };
  const { ui } = mountEditor(vi.fn(), [input], [output, surround]);
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

  await decide("group:applications");
  await decide(`toggle:${applications[0].id}`);
  await decide("group:output");
  await decide(`output:${output.id}`);
  expect(screen.queryByRole("checkbox", { name: "Surround" })).toBeNull();
  expect(screen.getByRole("checkbox", { name: "Player" })).toHaveProperty("checked", true);
  expect(screen.getByRole("checkbox", { name: "Speakers" })).toHaveProperty("checked", true);
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("status").textContent).toContain("Deselect applications");
  await decide(`toggle:${applications[0].id}`);
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);

  await decide("group:input");
  await decide(`input:${input.id}`);
  await decide("input-toggle:0");
  expect(screen.getByRole("status").textContent).toContain("counted twice");
  await decide("save");
  expect(vi.mocked(sourceMixesStore.persist).mock.calls[0][0].list[0]).toMatchObject({
    members: [],
    inputs: [{ id: input.id, channels: [0] }],
    output: { id: output.id, label: output.label },
  });
});

it("edits a mono route in 5.1 and requires repair when switching to stereo", async () => {
  const input = { id: `cap-${"3".repeat(32)}`, label: "Microphone", channels: 1 };
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
  await decide("input-toggle:0");
  await decide("format:5-1");
  await decide(`routing:${input.id}`);
  expect(
    within(screen.getByRole("group", { name: "per-channel settings" })).getByText("Auto · C")
  ).toBeTruthy();
  await decide("route:add:0:Ls");
  expect(screen.getByRole("combobox", { name: "destination for Channel 1" })).toHaveProperty(
    "value",
    "Ls"
  );
  await decide("format:stereo");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("status").textContent).toContain("Fix the unavailable channel routes");
  await decide("route:auto:0");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
  await decide("format:5-1");
  await decide("route:add:0:Ls");
  await decide("save");
  expect(vi.mocked(sourceMixesStore.persist).mock.calls[0][0].list[0]).toMatchObject({
    format: "5.1",
    routes: { [input.id]: { 0: [["Ls", 1]] } },
  });
});

it("routes mono and stereo from their row dropdowns and opens details beneath only that row", () => {
  const input = { id: `cap-${"3".repeat(32)}`, label: "Microphone", channels: 2 };
  mountEditor(vi.fn(), [input]);
  fireEvent.click(screen.getByRole("button", { name: "Input" }));
  fireEvent.click(screen.getByRole("button", { name: "Microphone" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Channel 1" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Channel 2" }));
  fireEvent.change(screen.getByRole("combobox", { name: "mix format" }), {
    target: { value: "5.1" },
  });
  const first = screen.getByRole("combobox", { name: "route for Channel 1" });
  const second = screen.getByRole("combobox", { name: "route for Channel 2" });
  const choose = (trigger, option) => {
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: option }));
  };
  expect(first.textContent).toContain("Auto · C");
  choose(first, "Ls");
  expect(first.textContent).toBe("Ls");
  expect(second.textContent).toBe("Auto · C");
  expect(screen.queryByRole("group", { name: "per-channel settings" })).toBeNull();

  choose(first, "Per-Channel Settings");
  const details = screen.getByRole("group", { name: "per-channel settings" });
  expect(
    within(details).getByRole("spinbutton", { name: "gain for Channel 1 to Ls" })
  ).toBeTruthy();
  expect(within(details).queryByText("Channel 2")).toBeNull();
  expect(details.previousElementSibling.contains(first)).toBe(true);
  fireEvent.click(within(details).getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("group", { name: "per-channel settings" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Applications" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Player" }));
  const stereo = screen.getByRole("combobox", { name: "route for Player" });
  expect(stereo.textContent).toBe("Auto · L / R");
  choose(stereo, "Ls / Rs");
  expect(stereo.textContent).toBe("Ls / Rs");
  choose(stereo, "Per-Channel Settings");
  const stereoDetails = screen.getByRole("group", { name: "per-channel settings" });
  expect(within(stereoDetails).getByRole("combobox", { name: "destination for L" })).toHaveProperty(
    "value",
    "Ls"
  );
  expect(within(stereoDetails).getByRole("combobox", { name: "destination for R" })).toHaveProperty(
    "value",
    "Rs"
  );
});
