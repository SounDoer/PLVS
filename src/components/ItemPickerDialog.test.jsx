/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ItemPickerDialog } from "./ItemPickerDialog.jsx";

const PROFILES = [
  { id: "a", name: "Alpha", referenceLufs: -23, rules: [] },
  { id: "b", name: "Beta", referenceLufs: -16, rules: [] },
];

describe("ItemPickerDialog pick mode", () => {
  it("lists the library and exports the checked ids", () => {
    const onExport = vi.fn();
    render(
      <ItemPickerDialog
        open
        mode="pick"
        type="loudness"
        items={PROFILES}
        dependencies={[]}
        onExport={onExport}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport).toHaveBeenCalledWith(["a"]);
  });

  it("disables Export while nothing is checked", () => {
    render(
      <ItemPickerDialog
        open
        mode="pick"
        type="loudness"
        items={PROFILES}
        dependencies={[]}
        onExport={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "Export" }).disabled).toBe(true);
  });

  it("shows a dependency row only once the preset that needs it is checked", () => {
    render(
      <ItemPickerDialog
        open
        mode="pick"
        type="presets"
        items={[
          { id: "p1", name: "P1", loudnessProfileActive: "profile:a" },
          { id: "p2", name: "P2", loudnessProfileActive: "off" },
        ]}
        dependencies={PROFILES}
        onExport={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.queryByText("Also included")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "P2" }));
    expect(screen.queryByText("Also included")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "P1" }));
    expect(screen.getByText("Also included")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("Beta")).toBeNull();
  });

  it("shows an empty state instead of a blank list", () => {
    render(
      <ItemPickerDialog
        open
        mode="pick"
        type="themes"
        items={[]}
        dependencies={[]}
        onExport={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("No custom themes to export.")).toBeTruthy();
  });
});
