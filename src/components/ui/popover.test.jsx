/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Popover, PopoverContent, PopoverTrigger } from "./popover.jsx";

function TestPopover(props) {
  return (
    <Popover {...props}>
      <PopoverTrigger>Open popover</PopoverTrigger>
      <PopoverContent>Popover content</PopoverContent>
    </Popover>
  );
}

describe("Popover", () => {
  it("closes when the application window loses focus", async () => {
    render(<TestPopover />);

    fireEvent.click(screen.getByRole("button", { name: "Open popover" }));
    expect(screen.getByText("Popover content")).toBeTruthy();

    fireEvent(window, new Event("blur"));

    await waitFor(() => expect(screen.queryByText("Popover content")).toBeNull());
  });

  it("notifies controlled consumers when the application window loses focus", () => {
    const onOpenChange = vi.fn();
    render(<TestPopover open onOpenChange={onOpenChange} />);

    fireEvent(window, new Event("blur"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
