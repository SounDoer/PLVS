import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, listen, unlisten } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

import {
  announceAgentControlFrontendNotReady,
  announceAgentControlFrontendReady,
  listenForAgentControlRequests,
  respondToAgentControlRequest,
} from "./agentControlEvents.js";

beforeEach(() => {
  invoke.mockReset();
  listen.mockReset().mockResolvedValue(unlisten);
  unlisten.mockReset();
});

describe("agent-control Tauri adapter", () => {
  it("listens to the targeted request event and returns its cleanup", async () => {
    const handler = vi.fn();
    const cleanup = await listenForAgentControlRequests(handler);
    expect(listen).toHaveBeenCalledWith("agent-control://request", expect.any(Function));

    listen.mock.calls[0][1]({ payload: { id: "req-1" } });
    expect(handler).toHaveBeenCalledWith({ id: "req-1" });

    cleanup();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("maps lifecycle and correlated response commands exactly", async () => {
    const response = { requestId: "req-1", result: { revision: 2 } };
    await announceAgentControlFrontendReady();
    await respondToAgentControlRequest(response);
    await announceAgentControlFrontendNotReady();

    expect(invoke).toHaveBeenNthCalledWith(1, "agent_control_frontend_ready");
    expect(invoke).toHaveBeenNthCalledWith(2, "agent_control_respond", { response });
    expect(invoke).toHaveBeenNthCalledWith(3, "agent_control_frontend_not_ready");
  });
});
