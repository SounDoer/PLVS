/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DockImportApp } from "./DockImportApp.jsx";
const client = vi.hoisted(() => ({ payload: null, action: vi.fn() }));
vi.mock("./useAccessoryClient.js", () => ({ useAccessoryClient: () => client }));
it("shows dispositions, dependencies and warnings and dispatches cancellation", () => {
  client.payload = {
    key: "1:review",
    mode: "review",
    review: {
      type: "presets",
      itemPlan: [{ sourceId: "a", name: "Example", disposition: "added" }],
      profilePlan: [{ sourceId: "b", name: "Included", disposition: "skipped" }],
      warnings: [{ code: "adapted", message: "Adapted to this version" }],
    },
  };
  render(<DockImportApp />);
  expect(screen.getByText("Example")).toBeTruthy();
  expect(screen.getByText("Included")).toBeTruthy();
  expect(screen.getByText("Adapted to this version")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(client.action).toHaveBeenCalledWith("import-dismiss", { key: "1:review" });
});
it("shows completion errors alongside the optional action", () => {
  client.payload = {
    key: "1:complete",
    mode: "complete",
    status: "Follow-up refused",
    review: {
      type: "themes",
      itemPlan: [{ sourceId: "a", name: "Example", disposition: "added" }],
    },
  };
  render(<DockImportApp />);
  expect(screen.getByRole("status").textContent).toBe("Follow-up refused");
  expect(screen.getByRole("button", { name: "Use Theme" })).toBeTruthy();
});
