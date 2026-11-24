/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { BlockingEditorsProvider, useBlockingEditors } from "../hooks/BlockingEditorsContext.jsx";
import { useSourceMixes } from "../hooks/useSourceMixes.js";
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

function mountEditor(onSelect = vi.fn()) {
  let registry;
  function Harness() {
    const owner = useSourceMixes({ supported: true, onSelect, onError: vi.fn() });
    registry = useBlockingEditors();
    return owner.draft ? (
      <SourceMixEditor owner={owner} applications={applications} />
    ) : (
      <button onClick={() => owner.open()}>Add Mix</button>
    );
  }
  render(
    <BlockingEditorsProvider>
      <Harness />
    </BlockingEditorsProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Add Mix" }));
  return { onSelect, scene: () => registry };
}

it("blocks scene mutation from an open draft and discards it on Cancel", () => {
  const { onSelect, scene } = mountEditor();
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
