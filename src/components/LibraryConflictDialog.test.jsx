/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
  resolveLibraryConflict: vi.fn(),
  publish: null,
  establishDevelopmentLibraryConflict: vi.fn(),
  matchesDevelopmentLibraryConflict: vi.fn(() => false),
  resetDevelopmentLibraryConflict: vi.fn(),
  invoke: vi.fn(async () => null),
  exit: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: controls.invoke }));
vi.mock("@tauri-apps/plugin-process", () => ({ exit: controls.exit }));
vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../persistence/index.js", () => ({
  flushPersistence: async () => {},
  subscribeLibraryConflicts: (listener) => {
    controls.publish = listener;
    listener(null);
    return () => {};
  },
  resolveLibraryConflict: controls.resolveLibraryConflict,
  establishDevelopmentLibraryConflict: controls.establishDevelopmentLibraryConflict,
  matchesDevelopmentLibraryConflict: controls.matchesDevelopmentLibraryConflict,
  resetDevelopmentLibraryConflict: controls.resetDevelopmentLibraryConflict,
}));

import { LibraryConflictDialog } from "./LibraryConflictDialog.jsx";
import { BlockingEditorsProvider, useBlockingEditors } from "../hooks/BlockingEditorsContext.jsx";
import {
  prepareGlobalOperation,
  quitCurrentWorkbench,
  useRuntimeCoordination,
} from "../runtime/coordination.js";

describe("LibraryConflictDialog", () => {
  beforeEach(() => controls.resolveLibraryConflict.mockReset().mockResolvedValue(undefined));

  it("offers reload and save-as-copy without a force-overwrite action", async () => {
    render(<LibraryConflictDialog />);
    controls.publish({ kind: "theme", id: "theme-one" });

    expect(await screen.findByText("Theme Changed Elsewhere")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /overwrite/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save as Copy" }));

    await waitFor(() => expect(controls.resolveLibraryConflict).toHaveBeenCalledWith("copy"));
  });

  it("asks the user to reload before deciding whether to retry a deletion", async () => {
    render(<LibraryConflictDialog />);
    controls.publish({ kind: "preset", id: "one", operation: "delete" });

    expect(await screen.findByText("Preset Changed Elsewhere")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save as Copy" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() => expect(controls.resolveLibraryConflict).toHaveBeenCalledWith("reload"));
  });

  it("offers only Reload when a shared list change conflicts", async () => {
    render(<LibraryConflictDialog />);
    controls.publish({ kind: "preset", operation: "collection" });

    expect(await screen.findByText("Preset List Changed Elsewhere")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save as Copy" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(controls.resolveLibraryConflict).toHaveBeenCalledWith("reload"));
  });

  it("blocks quit and scene mutations until the Library conflict has been resolved", async () => {
    let guard;
    function Coordination() {
      guard = useBlockingEditors();
      useRuntimeCoordination({
        blockingEditors: guard.activeBlockingEditors,
        running: false,
        stop: async () => {},
        start: async () => {},
        show: async () => {},
      });
      return null;
    }
    render(
      <BlockingEditorsProvider>
        <Coordination />
        <LibraryConflictDialog />
      </BlockingEditorsProvider>
    );
    act(() => controls.publish({ kind: "preset", operation: "collection" }));
    controls.invoke.mockClear();
    controls.exit.mockClear();
    await act(async () => {
      await expect(quitCurrentWorkbench()).rejects.toMatchObject({ code: "editorActive" });
      await expect(prepareGlobalOperation()).rejects.toMatchObject({ code: "editorActive" });
    });
    expect(() => guard.assertSceneOperationAllowed("preset.apply")).toThrow();
    expect(() => guard.assertSceneOperationAllowed("dock.enter")).toThrow();
    expect(controls.invoke).not.toHaveBeenCalledWith("runtime_retire_current_workspace");
    expect(controls.invoke).not.toHaveBeenCalledWith("runtime_issue_commands", expect.anything());
    expect(controls.exit).not.toHaveBeenCalled();
    act(() => controls.publish(null));
    await act(async () => {
      await quitCurrentWorkbench();
    });
    expect(controls.exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});
