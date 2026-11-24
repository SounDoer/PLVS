/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DragHandle } from "./drag-handle.jsx";
import { SortableList } from "./sortable-list.jsx";

const motion = vi.hoisted(() => ({ updateOrder: null }));
vi.mock("framer-motion", () => ({
  Reorder: {
    Group: ({ children, onReorder }) => {
      motion.updateOrder = onReorder;
      return <div>{children}</div>;
    },
    Item: ({ children, className, "data-reorder-pressed": pressed }) => (
      <div className={className} data-reorder-pressed={pressed}>
        {children}
      </div>
    ),
  },
  useDragControls: () => ({ start: () => {}, cancel: () => {} }),
  useReducedMotion: () => false,
}));

const renderRow = (id, _index, handle) => <DragHandle aria-label={`Reorder ${id}`} {...handle} />;
const pointer = { pointerId: 1, isPrimary: true, button: 0 };

function pressA() {
  const handle = screen.getByRole("button", { name: "Reorder a" });
  expect(fireEvent.pointerDown(handle, pointer)).toBe(false);
  return handle;
}

function visibleOrder() {
  return screen.getAllByRole("button").map((item) => item.getAttribute("aria-label"));
}

describe("SortableList", () => {
  it("highlights on press, previews order, and commits once on release", () => {
    const onReorder = vi.fn();
    render(<SortableList ids={["a", "b", "c"]} renderRow={renderRow} onReorder={onReorder} />);
    const handle = pressA();
    expect(handle.closest("[data-reorder-pressed]")).toBeTruthy();
    fireEvent.blur(handle);
    expect(handle.closest("[data-reorder-pressed]")).toBeTruthy();
    act(() => motion.updateOrder(["b", "a", "c"]));
    act(() => motion.updateOrder(["b", "c", "a"]));
    expect(visibleOrder()).toEqual(["Reorder b", "Reorder c", "Reorder a"]);
    expect(onReorder).not.toHaveBeenCalled();

    fireEvent.pointerUp(window, pointer);
    expect(handle.closest("[data-reorder-pressed]")).toBeNull();
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(["b", "c", "a"]);
    expect(visibleOrder()).toEqual(["Reorder b", "Reorder c", "Reorder a"]);
  });

  it("drops the preview on pointer cancellation without committing", () => {
    const onReorder = vi.fn();
    render(<SortableList ids={["a", "b"]} renderRow={renderRow} onReorder={onReorder} />);
    const handle = pressA();
    act(() => motion.updateOrder(["b", "a"]));
    fireEvent.pointerCancel(window, pointer);

    expect(handle.closest("[data-reorder-pressed]")).toBeNull();
    expect(visibleOrder()).toEqual(["Reorder a", "Reorder b"]);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("keeps an order changed by its owner during a drag", () => {
    const onReorder = vi.fn();
    const view = render(
      <SortableList ids={["a", "b"]} renderRow={renderRow} onReorder={onReorder} />
    );
    pressA();
    act(() => motion.updateOrder(["b", "a"]));
    view.rerender(<SortableList ids={["a", "c"]} renderRow={renderRow} onReorder={onReorder} />);
    fireEvent.pointerUp(window, pointer);

    expect(visibleOrder()).toEqual(["Reorder a", "Reorder c"]);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("hands a positional order back to its owner instead of applying it twice", () => {
    const onReorder = vi.fn();
    render(
      <SortableList positionalIds ids={["a", "b"]} renderRow={renderRow} onReorder={onReorder} />
    );
    pressA();
    act(() => motion.updateOrder(["b", "a"]));
    fireEvent.pointerUp(window, pointer);

    expect(onReorder).toHaveBeenCalledExactlyOnceWith(["b", "a"]);
    expect(visibleOrder()).toEqual(["Reorder a", "Reorder b"]);
  });
});
