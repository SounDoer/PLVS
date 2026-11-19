/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
  resolveLibraryConflict: vi.fn(),
  publish: null,
  establishDevelopmentLibraryConflict: vi.fn(),
  matchesDevelopmentLibraryConflict: vi.fn(() => false),
  resetDevelopmentLibraryConflict: vi.fn(),
}));
vi.mock("../persistence/index.js", () => ({
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
});
