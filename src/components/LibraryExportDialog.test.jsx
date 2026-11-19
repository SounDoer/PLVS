/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LibraryExportDialog } from "./LibraryExportDialog.jsx";

const ITEMS = {
  loudness: [
    { id: "profile-a", name: "Profile A" },
    { id: "profile-b", name: "Profile B" },
  ],
  presets: [{ id: "preset-a", name: "Preset A", loudnessProfileActive: "off" }],
  themes: [],
};

describe("LibraryExportDialog", () => {
  it("starts with Library types and their available item counts", () => {
    render(<LibraryExportDialog open itemsByType={ITEMS} />);

    expect(screen.getByRole("dialog", { name: "Export Saved Items" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Loudness Profiles\s*2 items/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Presets\s*1 item/ })).toBeTruthy();
    expect(
      /** @type {HTMLButtonElement} */ (screen.getByRole("button", { name: /Themes\s*0 items/ }))
        .disabled
    ).toBe(true);
  });

  it("opens the existing item picker for one type and can return to the type list", () => {
    render(<LibraryExportDialog open itemsByType={ITEMS} />);

    fireEvent.click(screen.getByRole("button", { name: /Presets\s*1 item/ }));
    expect(screen.getByRole("dialog", { name: "Export Presets" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Preset A" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Export Saved Items" })).toBeTruthy();
  });

  it("passes the selected type and ids to export", async () => {
    const onExport = vi.fn().mockResolvedValue("written");
    const onClose = vi.fn();
    render(<LibraryExportDialog open itemsByType={ITEMS} onExport={onExport} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /Loudness Profiles\s*2 items/ }));
    const dialog = screen.getByRole("dialog", { name: "Export Loudness Profiles" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Profile B" }));
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Export" })));

    expect(onExport).toHaveBeenCalledWith("loudness", ["profile-b"]);
  });

  it("keeps the selection visible when the write fails and closes when the retry succeeds", async () => {
    const onExport = vi.fn().mockResolvedValueOnce("failed").mockResolvedValueOnce("written");
    const onClose = vi.fn();
    render(
      <LibraryExportDialog
        open
        itemsByType={ITEMS}
        status="Export failed"
        onExport={onExport}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Loudness Profiles\s*2 items/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Profile B" }));

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Export" })));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("Export failed");
    expect(screen.getByRole("checkbox", { name: "Profile B", checked: true })).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Export" })));
    expect(onExport.mock.calls).toEqual([
      ["loudness", ["profile-b"]],
      ["loudness", ["profile-b"]],
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("notifies the user when a selection changes and keeps the available items checked", async () => {
    const onExport = vi.fn().mockResolvedValue("written");
    const { rerender } = render(
      <LibraryExportDialog open itemsByType={ITEMS} onExport={onExport} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Loudness Profiles\s*2 items/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Profile A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Profile B" }));

    rerender(
      <LibraryExportDialog
        open
        itemsByType={{ loudness: [ITEMS.loudness[0]] }}
        onExport={onExport}
      />
    );
    expect(screen.getByRole("status").textContent).toMatch(
      /selected items are no longer available/
    );
    expect(screen.getByRole("checkbox", { name: "Profile A", checked: true })).toBeTruthy();
    expect(onExport).not.toHaveBeenCalled();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Export" })));
    expect(onExport).toHaveBeenCalledWith("loudness", ["profile-a"]);
  });
});
