/** @vitest-environment jsdom */
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockHeaderApp } from "./DockHeaderApp.jsx";

const { client } = vi.hoisted(() => ({ client: { payload: null, action: vi.fn() } }));

vi.mock("./useAccessoryClient.js", () => ({
  useAccessoryClient: () => client,
}));

describe("DockHeaderApp", () => {
  it("asks the main window to dismiss on Escape", () => {
    const { unmount } = render(<DockHeaderApp />);

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Enter" });
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(client.action.mock.calls).toEqual([["dismiss-toolbar"]]);
  });
});
