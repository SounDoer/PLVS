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

it("clips a transparent host's modal backdrop to its editor and updates after host resize", () => {
  let rect = new DOMRect(100, 80, 416, 388);
  let editor;
  const onClose = vi.fn();
  function Host() {
    const ref = useRef(null);
    return (
      <FloatingPanelHostProvider startDragging={null} getModalBackdropElement={() => ref.current}>
        <section
          ref={(element) => {
            ref.current = element;
            editor = element;
            if (element) element.getBoundingClientRect = () => rect;
          }}
          style={{ borderRadius: "12px" }}
        >
          Editor
        </section>
        <Content onClose={onClose} />
      </FloatingPanelHostProvider>
    );
  }
  render(<Host />);
  const overlay = /** @type {HTMLDivElement} */ (
    document.querySelector('[data-modal-backdrop-scope="panel"]')
  );
  const expected = () =>
    `inset(${rect.top}px ${Math.max(0, window.innerWidth - rect.right)}px ${Math.max(0, window.innerHeight - rect.bottom)}px ${rect.left}px round 12px)`;
  expect(overlay.style.clipPath).toBe(expected());
  rect = new DOMRect(200, 150, 416, 388);
  fireEvent(window, new Event("resize"));
  expect(overlay.style.clipPath).toBe(expected());
  expect(screen.getByRole("dialog", { name: "Preview" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
  expect(editor).toBeTruthy();
});
