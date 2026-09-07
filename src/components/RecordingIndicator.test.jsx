/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RecordingIndicator } from "./RecordingIndicator.jsx";

afterEach(cleanup);

describe("RecordingIndicator", () => {
  it.each(["starting", "recording", "stopping"])("is visible while %s", (state) => {
    render(<RecordingIndicator state={state} />);
    expect(screen.getByRole("status").dataset.recordingState).toBe(state);
  });

  it.each([null, "completed", "failed"])("is absent for %s", (state) => {
    render(<RecordingIndicator state={state} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
