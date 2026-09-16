/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordFrontendCrash } = vi.hoisted(() => ({ recordFrontendCrash: vi.fn() }));

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../ipc/commands.js", () => ({ recordFrontendCrash }));

import { AppCrashBoundary } from "./AppCrashBoundary.jsx";

function ThrowingChild() {
  throw Object.assign(new Error("render failed"), {
    name: "TypeError",
    stack: "TypeError: render failed\n at Meter.jsx:10",
  });
}

beforeEach(() => {
  recordFrontendCrash.mockReset();
  recordFrontendCrash.mockResolvedValue(undefined);
});

describe("AppCrashBoundary", () => {
  it("renders healthy children unchanged", () => {
    render(
      <AppCrashBoundary>
        <div>Healthy App</div>
      </AppCrashBoundary>
    );

    expect(screen.getByText("Healthy App")).toBeTruthy();
  });

  it("records one normalized render failure and shows a stable fallback", async () => {
    render(
      <AppCrashBoundary>
        <ThrowingChild />
      </AppCrashBoundary>
    );

    expect(screen.getByRole("heading", { name: "PLVS Encountered an Error" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    await waitFor(() => expect(recordFrontendCrash).toHaveBeenCalledTimes(1));
    expect(recordFrontendCrash).toHaveBeenCalledWith({
      name: "TypeError",
      message: "render failed",
      stack: "TypeError: render failed\n at Meter.jsx:10",
      componentStack: expect.stringContaining("ThrowingChild"),
    });
  });

  it("reloads without depending on the failed application tree", () => {
    const reload = vi.fn();
    render(
      <AppCrashBoundary reload={reload}>
        <ThrowingChild />
      </AppCrashBoundary>
    );

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the fallback usable when saving the report fails", async () => {
    recordFrontendCrash.mockRejectedValueOnce(new Error("disk full"));
    render(
      <AppCrashBoundary>
        <ThrowingChild />
      </AppCrashBoundary>
    );

    await waitFor(() => expect(recordFrontendCrash).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });
});
