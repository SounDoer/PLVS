/** @vitest-environment jsdom */
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  EditorDraftProvider,
  useEditorDraftRegistry,
  useEditorDraftSurface,
} from "../agentControl/EditorDraftContext.jsx";
import { UiNavigationProvider, useUiNavigation } from "../uiNavigation/UiNavigationContext.jsx";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";

function setup(overrides = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Reset PLVS to Default?"
      description="Everything is erased."
      confirmLabel="Reset PLVS"
      onConfirm={onConfirm}
      {...overrides}
    />
  );
  return { onConfirm, onOpenChange };
}

describe("ConfirmDialog", () => {
  it("shows the title and description as an alertdialog", () => {
    setup();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Reset PLVS to Default?");
    expect(dialog.textContent).toContain("Everything is erased.");
  });

  it("runs nothing until the destructive button is pressed", () => {
    const { onConfirm } = setup();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reset PLVS" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // The dialog closes itself before handing control over, so a confirm handler that unmounts its
  // own owner cannot leave an orphaned open dialog behind.
  it("closes before running the confirm handler", () => {
    const order = [];
    const onOpenChange = vi.fn((next) => order.push(`open:${next}`));
    const onConfirm = vi.fn(() => order.push("confirm"));
    setup({ onOpenChange, onConfirm });
    fireEvent.click(screen.getByRole("button", { name: "Reset PLVS" }));
    expect(order).toEqual(["open:false", "confirm"]);
  });

  it("dismisses without confirming", () => {
    const { onConfirm, onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("takes a custom dismiss label", () => {
    setup({ cancelLabel: "Keep Editing" });
    expect(screen.getByRole("button", { name: "Keep Editing" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("renders nothing while closed", () => {
    setup({ open: false });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("ConfirmDialog editor draft decision", () => {
  it("projects and registers only an explicitly linked discard decision", async () => {
    const onConfirm = vi.fn();
    /** @type {any} */
    let registry;
    /** @type {any} */
    let navigation;

    function Harness() {
      const [open, setOpen] = useState(true);
      registry = useEditorDraftRegistry();
      navigation = useUiNavigation();
      useEditorDraftSurface({
        active: true,
        kind: "theme",
        surfaceId: "editor-surface",
        controller: {
          inspectDraft: () => ({ draftGeneration: 5, dirty: true, document: { name: "Draft" } }),
        },
      });
      return (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Discard?"
          description="Discard the draft."
          confirmLabel="Discard"
          onConfirm={onConfirm}
          editorDraftDecision={{ editorKind: "theme", editorSurfaceId: "editor-surface" }}
        />
      );
    }

    render(
      <BlockingEditorsProvider>
        <EditorDraftProvider>
          <UiNavigationProvider>
            <Harness />
          </UiNavigationProvider>
        </EditorDraftProvider>
      </BlockingEditorsProvider>
    );
    const decision = navigation.inspectUi().surfaces.find(({ kind }) => kind === "confirmation");
    expect(decision).toMatchObject({
      target: {
        phase: "decision",
        purpose: "discardDraft",
        editorKind: "theme",
        editorSurfaceId: "editor-surface",
      },
    });

    await act(async () => {
      registry.discard("theme", "editor-surface", decision.surfaceId, 5);
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(navigation.inspectUi().surfaces).toEqual([]);
  });
});
