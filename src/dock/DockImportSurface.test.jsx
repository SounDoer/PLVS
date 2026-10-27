/** @vitest-environment jsdom */
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DockImportSurface } from "./DockImportSurface.jsx";

const mock = vi.hoisted(() => ({
  listener: null,
  options: null,
  dock: null,
  updates: null,
  error: null,
  setActive: vi.fn(),
}));
vi.mock("./DockContext.jsx", () => ({ useDock: () => mock.dock }));
vi.mock("./DockAccessoriesContext.jsx", () => ({
  useDockAccessories: () => ({ setImportActive: mock.setActive }),
}));
vi.mock("./useDockImportWindow.js", () => ({
  useDockImportWindow: (options) => {
    mock.options = options;
    return { error: mock.error };
  },
}));
vi.mock("../hooks/AppLifecycleContext.jsx", () => ({
  useAppLifecycle: () => ({ updateControls: mock.updates }),
}));
vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../ipc/dockAccessoryEvents.js", () => ({
  listenDockAccessoryAction: async (listener) => {
    mock.listener = listener;
    return () => {};
  },
}));
const settings = {
  interfaceSize: "default",
  updatePreferences: { choiceMade: true },
  setFixedThemeIdFromPicker: vi.fn(),
};
const loudnessProfile = { select: vi.fn() };
const presets = { apply: vi.fn() };
let pack;
beforeEach(() => {
  mock.dock = {
    docked: true,
    dockEdge: "bottom",
    dockSuspended: false,
    exitDockRestoringAttributes: vi.fn(),
  };
  mock.updates = { enabled: true, details: null };
  mock.error = null;
  mock.listener = null;
  mock.setActive.mockClear();
  pack = {
    busy: false,
    review: null,
    completion: null,
    status: "",
    beginPaste: vi.fn(async () => {}),
    confirmImport: vi.fn(),
    cancelImport: vi.fn(),
    dismissCompletion: vi.fn(),
    runCompletionAction: vi.fn(async () => true),
  };
});
function mount() {
  return render(<DockImportSurface {...{ pack, settings, loudnessProfile, presets }} />);
}
const paste = (target, text) => fireEvent.paste(target, { clipboardData: { getData: () => text } });
it("routes paste from the strip and accessory windows while leaving editable content alone", async () => {
  mount();
  await waitFor(() => expect(mock.listener).toBeTypeOf("function"));
  const input = document.createElement("input");
  document.body.appendChild(input);
  expect(paste(input, "editing")).toBe(true);
  expect(pack.beginPaste).not.toHaveBeenCalled();
  paste(window, "strip");
  await waitFor(() => expect(pack.beginPaste).toHaveBeenCalledWith("strip"));
  await act(async () =>
    mock.listener({ surface: "dock-editor", type: "import-paste", payload: { text: "editor" } })
  );
  expect(pack.beginPaste).toHaveBeenCalledWith("editor");
  input.remove();
});
it("does not replace pending review and only confirms once", async () => {
  pack.review = { type: "themes", itemPlan: [] };
  mount();
  paste(window, "new");
  expect(pack.beginPaste).not.toHaveBeenCalled();
  const { key } = mock.options.payload;
  act(() => {
    mock.options.onAction({ type: "import-confirm", payload: { key } });
    mock.options.onAction({ type: "import-confirm", payload: { key } });
  });
  expect(pack.confirmImport).toHaveBeenCalledOnce();
});
it("preserves review when the native accessory fails and yields to an update", () => {
  pack.review = { type: "themes", itemPlan: [] };
  mock.error = "failed";
  mock.updates.details = {};
  mount();
  expect(mock.options.active).toBe(false);
  expect(mock.dock.exitDockRestoringAttributes).toHaveBeenCalledOnce();
  expect(pack.cancelImport).not.toHaveBeenCalled();
  expect(pack.confirmImport).not.toHaveBeenCalled();
});

it("keeps an invalid-paste message until it can be shown after an update", () => {
  mock.updates.details = {};
  const view = mount();
  paste(window, "invalid");
  pack.status = "Clipboard doesn't contain a PLVS item.";
  view.rerender(<DockImportSurface {...{ pack, settings, loudnessProfile, presets }} />);
  expect(mock.options.active).toBe(false);
  pack.status = "";
  mock.updates.details = null;
  view.rerender(<DockImportSurface {...{ pack, settings, loudnessProfile, presets }} />);
  expect(mock.options.active).toBe(true);
  expect(mock.options.payload.status).toContain("Clipboard");
});
