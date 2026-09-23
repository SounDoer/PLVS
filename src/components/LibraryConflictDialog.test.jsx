/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({ resolveLibraryConflict: vi.fn(), publish: null }));
vi.mock("../persistence/index.js", () => ({
  subscribeLibraryConflicts: (listener) => {
    controls.publish = listener;
    listener(null);
    return () => {};
  },
  resolveLibraryConflict: controls.resolveLibraryConflict,
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
});
