/** @vitest-environment jsdom */
import { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FloatingPanelHostProvider } from "../../hooks/FloatingPanelHostContext.jsx";
import { Dialog, DialogContent, DialogTitle } from "./dialog.jsx";

function Content({ onClose = () => {} }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Preview</DialogTitle>
        <button>Preview Control</button>
      </DialogContent>
    </Dialog>
  );
}

it("keeps the ordinary application's backdrop scoped to its viewport", () => {
  render(<Content />);
  const overlay = /** @type {HTMLDivElement} */ (
    document.querySelector('[data-modal-backdrop-scope="viewport"]')
  );
  expect(overlay).toBeTruthy();
  expect(overlay.style.clipPath).toBe("");
});

it("attaches a transparent host's backdrop to its editor as the host repositions it", () => {
  const onClose = vi.fn();
  function Host() {
    const ref = useRef(null);
    return (
      <FloatingPanelHostProvider startDragging={null} getModalBackdropElement={() => ref.current}>
        <section
          ref={ref}
          data-testid="editor"
          style={{ position: "relative", borderRadius: "12px" }}
        >
          Editor
        </section>
        <Content onClose={onClose} />
      </FloatingPanelHostProvider>
    );
  }
  render(<Host />);
  const editor = screen.getByTestId("editor");
  const overlay = /** @type {HTMLDivElement} */ (
    document.querySelector('[data-modal-backdrop-scope="panel"]')
  );
  expect(overlay.parentElement).toBe(editor);
  expect(overlay.style.clipPath).toBe("");
  // Moving a same-size editor produces no ResizeObserver notification. The backdrop must move
  // with its actual containing block rather than depend on a cached viewport rectangle.
  editor.style.top = "200px";
  editor.style.left = "200px";
  expect(overlay.parentElement).toBe(editor);
  expect(screen.getByRole("dialog", { name: "Preview" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
});
