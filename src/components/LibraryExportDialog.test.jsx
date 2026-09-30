/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(screen.getByRole("button", { name: /Loudness Profiles 2 items/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Presets 1 item/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Themes 0 items/ }).disabled).toBe(true);
  });

  it("opens the existing item picker for one type and can return to the type list", () => {
    render(<LibraryExportDialog open itemsByType={ITEMS} />);

    fireEvent.click(screen.getByRole("button", { name: /Presets 1 item/ }));
    expect(screen.getByRole("dialog", { name: "Export Presets" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Preset A" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Export Saved Items" })).toBeTruthy();
  });

  it("passes the selected type and ids to export", () => {
    const onExport = vi.fn().mockResolvedValue("written");
    const onClose = vi.fn();
    render(<LibraryExportDialog open itemsByType={ITEMS} onExport={onExport} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /Loudness Profiles 2 items/ }));
    const dialog = screen.getByRole("dialog", { name: "Export Loudness Profiles" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Profile B" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Export" }));

    expect(onExport).toHaveBeenCalledWith("loudness", ["profile-b"]);
  });
});
