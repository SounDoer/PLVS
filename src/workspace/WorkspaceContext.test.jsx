/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { WorkspaceProvider, useWorkspaceStore } from "./WorkspaceContext.jsx";
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";

function Probe({ onState }) {
  const { state } = useWorkspaceStore();
  onState(state);
  return null;
}

describe("WorkspaceContext fullscreenId", () => {
  afterEach(() => localStorage.clear());

  it("never restores fullscreenId from storage", () => {
    localStorage.setItem(
      "plvs:workspace",
      JSON.stringify({ ...DEFAULT_WORKSPACE_STATE, fullscreenId: "peak" })
    );
    let captured = null;
    render(
      <WorkspaceProvider>
        <Probe onState={(s) => (captured = s)} />
      </WorkspaceProvider>
    );
    expect(captured.fullscreenId).toBeNull();
  });
});
