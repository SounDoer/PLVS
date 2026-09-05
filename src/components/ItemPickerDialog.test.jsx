/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ItemPickerDialog } from "./ItemPickerDialog.jsx";

// jsdom has no native PointerEvent constructor, so fireEvent.pointerDown/Move's clientX/clientY
// never reach the handler without this -- every field lands as undefined and the drag math
// silently NaNs out. MouseEvent already carries clientX/clientY, so subclassing it is enough
// (same shim as SpectrogramPanel.test.jsx).
if (typeof window.PointerEvent === "undefined") {
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, params = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  };
}

// jsdom reports zero-size boxes and doesn't implement setPointerCapture, so both are stubbed the
// same way the rest of this repo's drag tests do it (see e.g. SpectrogramPanel.test.jsx).
function stubDragGeometry(content, { width = 200, height = 100, left = 300, top = 250 } = {}) {
  vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
  });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
}

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
    expect(screen.queryByText("Also Included: Loudness Profiles")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "P2" }));
    expect(screen.queryByText("Also Included: Loudness Profiles")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "P1" }));
    expect(screen.getByText("Also Included: Loudness Profiles")).toBeTruthy();
    // Naming the kind answers "what"; this line answers "why is something I did not pick here".
    expect(screen.getByText("Presets reference these, so they travel together.")).toBeTruthy();
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

describe("ItemPickerDialog review mode", () => {
  const review = {
    itemPlan: [
      { sourceId: "p1", finalId: "p1", name: "P1", disposition: "added" },
      { sourceId: "p2", finalId: "p2", name: "P2", disposition: "skipped" },
      { sourceId: "p3", finalId: "x", name: "P3 (2)", disposition: "duplicated" },
    ],
    profilePlan: [{ sourceId: "a", finalId: "a", name: "Alpha", disposition: "added" }],
  };

  it("labels each row with its disposition", () => {
    render(
      <ItemPickerDialog
        open
        mode="review"
        type="presets"
        review={review}
        onConfirm={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("P1").closest("li").textContent).toContain("Add");
    expect(screen.getByText("P2").closest("li").textContent).toContain("Already in your library");
    expect(screen.getByText("P3 (2)").closest("li").textContent).toContain("Import as a copy");
  });

  it("shows the bundled profiles under Also included", () => {
    render(
      <ItemPickerDialog
        open
        mode="review"
        type="presets"
        review={review}
        onConfirm={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("Also Included: Loudness Profiles")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
  });

  it("confirms only when Import is pressed", () => {
    const onConfirm = vi.fn();
    render(
      <ItemPickerDialog
        open
        mode="review"
        type="presets"
        review={review}
        onConfirm={onConfirm}
        onClose={() => {}}
      />
    );
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("ItemPickerDialog dragging", () => {
  function renderDialog(open) {
    return render(
      <ItemPickerDialog
        open={open}
        mode="pick"
        type="loudness"
        items={PROFILES}
        dependencies={[]}
        onExport={() => {}}
        onClose={() => {}}
      />
    );
  }

  function drag(content, handle, from, to) {
    fireEvent.pointerDown(handle, { clientX: from.x, clientY: from.y, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: to.x, clientY: to.y, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
  }

  it("moves the dialog when the header is dragged", () => {
    renderDialog(true);
    const content = screen.getByRole("dialog");
    stubDragGeometry(content);
    const handle = screen.getByTestId("item-picker-drag-handle");
    handle.setPointerCapture = () => {};

    // Grab 50px into the 200x100 content (which sits at 300,250), then drag to 500,400.
    drag(content, handle, { x: 350, y: 280 }, { x: 500, y: 400 });

    expect(content.style.left).toBe("450px");
    expect(content.style.top).toBe("370px");
  });

  it("clamps a drag that would take the dialog off-screen", () => {
    renderDialog(true);
    const content = screen.getByRole("dialog");
    stubDragGeometry(content);
    const handle = screen.getByTestId("item-picker-drag-handle");
    handle.setPointerCapture = () => {};

    // Same grab point as above, but dragged far past the 1000x800 viewport.
    drag(content, handle, { x: 350, y: 280 }, { x: 5000, y: 5000 });

    expect(content.style.left).toBe("800px");
    expect(content.style.top).toBe("700px");
  });

  it("resets to centred on reopen", () => {
    const { rerender } = renderDialog(true);
    const content = screen.getByRole("dialog");
    stubDragGeometry(content);
    const handle = screen.getByTestId("item-picker-drag-handle");
    handle.setPointerCapture = () => {};

    drag(content, handle, { x: 350, y: 280 }, { x: 500, y: 400 });
    expect(content.style.left).toBe("450px");

    rerender(
      <ItemPickerDialog
        open={false}
        mode="pick"
        type="loudness"
        items={PROFILES}
        dependencies={[]}
        onExport={() => {}}
        onClose={() => {}}
      />
    );
    rerender(
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

    const reopened = screen.getByRole("dialog");
    expect(reopened.style.left).toBe("");
    expect(reopened.style.top).toBe("");
  });
});
