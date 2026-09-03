/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { WorkspaceProvider, useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { useAgentControlBridge } from "./useAgentControlBridge.js";

const adapter = vi.hoisted(() => ({
  handler: null,
  order: [],
  responses: [],
  unlisten: vi.fn(),
  listen: vi.fn(async (handler) => {
    adapter.order.push("listen");
    adapter.handler = handler;
    return adapter.unlisten;
  }),
  ready: vi.fn(async () => adapter.order.push("ready")),
  notReady: vi.fn(async () => adapter.order.push("not-ready")),
  respond: vi.fn(async (response) => adapter.responses.push(response)),
}));

vi.mock("../ipc/agentControlEvents.js", () => ({
  listenForAgentControlRequests: adapter.listen,
  announceAgentControlFrontendReady: adapter.ready,
  announceAgentControlFrontendNotReady: adapter.notReady,
  respondToAgentControlRequest: adapter.respond,
}));

const runtime = {
  available: true,
  appName: "PLVS Dev",
  appVersion: "0.14.5",
  identifier: "com.soundoer.plvs.dev",
  platform: "windows",
};

function request(method, params = {}, id = "req-1") {
  return { jsonrpc: "2.0", id, method, params };
}

function Harness({ enabled = true, flush = vi.fn(async () => {}), onStore = () => {} }) {
  const store = useWorkspaceStore();
  onStore(store);
  useAgentControlBridge({
    enabled,
    runtime,
    workspace: store.state,
    replaceWorkspace: store.replaceWorkspace,
    waitForWorkspacePersistenceEnqueue: store.waitForWorkspacePersistenceEnqueue,
    presets: { activeId: null, dirty: false },
    flush,
  });
  return null;
}

function mount(options = {}) {
  let store = null;
  const rendered = render(
    <WorkspaceProvider>
      <Harness {...options} onStore={(next) => (store = next)} />
    </WorkspaceProvider>
  );
  return {
    ...rendered,
    get store() {
      return store;
    },
  };
}

async function waitUntilReady() {
  await waitFor(() => expect(adapter.ready).toHaveBeenCalledTimes(1));
}

async function send(raw) {
  act(() => adapter.handler(raw));
  await waitFor(() =>
    expect(adapter.responses.some((response) => response.requestId === raw.id)).toBe(true)
  );
  return adapter.responses.find((response) => response.requestId === raw.id);
}

beforeEach(() => {
  localStorage.clear();
  adapter.handler = null;
  adapter.order.length = 0;
  adapter.responses.length = 0;
  adapter.unlisten.mockClear();
  adapter.listen.mockClear();
  adapter.ready.mockClear();
  adapter.notReady.mockClear();
  adapter.respond.mockClear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useAgentControlBridge", () => {
  it("installs the listener before ready and withdraws readiness on unmount", async () => {
    const view = mount();
    await waitUntilReady();
    expect(adapter.order.slice(0, 2)).toEqual(["listen", "ready"]);

    view.unmount();
    expect(adapter.unlisten).toHaveBeenCalledTimes(1);
    expect(adapter.notReady).toHaveBeenCalledTimes(1);
  });

  it("does not mount for an unavailable runtime or an accessory surface", async () => {
    mount({ enabled: false });
    await Promise.resolve();
    expect(adapter.listen).not.toHaveBeenCalled();
    expect(adapter.ready).not.toHaveBeenCalled();
  });

  it("keeps capabilities independent from the latest inspect revision", async () => {
    const view = mount();
    await waitUntilReady();
    const initialTree = view.store.state.tree;

    const capabilities = await send(request("app.capabilities", {}, "cap"));
    expect(capabilities.result).toMatchObject({ protocolVersion: 1 });
    expect(capabilities.result).not.toHaveProperty("revision");
    const first = await send(request("app.inspect", {}, "inspect-1"));
    expect(first.result.revisions.workspace).toBe(0);
    expect(first.result).not.toHaveProperty("revision");
    expect(view.store.state.tree).toBe(initialTree);

    act(() => view.store.setTree({ type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" }));
    const second = await send(request("app.inspect", {}, "inspect-2"));
    expect(second.result.revisions.workspace).toBe(1);
    expect(second.result.workspace.layout).toEqual({ type: "panel", panelId: "spectrum" });
  });

  it("does not advance the public revision for transient fullscreen state", async () => {
    const view = mount();
    await waitUntilReady();

    act(() => view.store.setFullscreen("spectrum"));
    const inspected = await send(request("app.inspect", {}, "inspect-fullscreen"));

    expect(inspected.result.revisions.workspace).toBe(0);
  });

  it("returns one structured error for invalid or unsupported requests", async () => {
    mount();
    await waitUntilReady();
    const response = await send(request("unknown.method", {}, "bad"));
    expect(response).toEqual({
      requestId: "bad",
      error: expect.objectContaining({
        code: -32601,
        data: expect.objectContaining({ reason: "methodNotFound" }),
      }),
    });
    expect(adapter.respond).toHaveBeenCalledTimes(1);
  });

  it("dry-runs with planned IDs without mutation or persistence", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const initialState = view.store.state;
    const response = await send(
      request(
        "workspace.applyLayout",
        {
          dryRun: true,
          expectedRevision: 0,
          layout: { type: "panel", key: "map", moduleId: "stereo-map" },
        },
        "dry"
      )
    );

    expect(response.result).toMatchObject({
      revision: 0,
      dryRun: true,
      persisted: false,
      createdPanels: { map: "stereo-map" },
    });
    expect(view.store.state).toBe(initialState);
    expect(flush).not.toHaveBeenCalled();
  });

  it("applies once, waits for commit and persistence, and returns the committed revision", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const response = await send(
      request(
        "workspace.applyLayout",
        {
          expectedRevision: 0,
          layout: { type: "panel", panelId: "spectrum" },
        },
        "apply"
      )
    );

    expect(response.result).toMatchObject({
      revision: 1,
      changed: ["workspace"],
      persisted: true,
      layout: { type: "panel", panelId: "spectrum" },
    });
    expect(view.store.state.tree).toEqual({
      type: "leaf",
      tabs: ["spectrum"],
      activeTab: "spectrum",
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("does not commit or persist when applying the current layout", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const initialState = view.store.state;
    const inspected = await send(request("app.inspect", {}, "inspect-current"));

    const response = await send(
      request(
        "workspace.applyLayout",
        { expectedRevision: 0, layout: inspected.result.workspace.layout },
        "apply-current"
      )
    );

    expect(response.result).toMatchObject({ revision: 0, changed: [] });
    expect(view.store.state).toBe(initialState);
    expect(flush).not.toHaveBeenCalled();
  });

  it("checks revision at the queue head before compiling or mutating", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    act(() => view.store.setTree({ type: "leaf", tabs: ["stats"], activeTab: "stats" }));

    const response = await send(
      request(
        "workspace.applyLayout",
        {
          expectedRevision: 0,
          layout: { type: "panel", key: "new", moduleId: "spectrum" },
        },
        "stale"
      )
    );

    expect(response.error).toMatchObject({
      code: -32004,
      data: expect.objectContaining({ reason: "revisionConflict" }),
    });
    expect(view.store.state.tree).toEqual({
      type: "leaf",
      tabs: ["stats"],
      activeTab: "stats",
    });
    expect(flush).not.toHaveBeenCalled();
  });

  it("reports the committed revision when persistence fails", async () => {
    const flush = vi.fn(async () => {
      throw new Error("disk full");
    });
    mount({ flush });
    await waitUntilReady();
    const response = await send(
      request(
        "workspace.applyLayout",
        { layout: { type: "panel", panelId: "spectrum" } },
        "failed-flush"
      )
    );
    expect(response.error).toMatchObject({
      code: -32030,
      data: {
        reason: "persistenceFailed",
        details: { stateCommitted: true, revision: 1 },
      },
    });
    expect(response).not.toHaveProperty("result");
  });

  it("serializes requests and never sends a late response after unmount", async () => {
    let releaseFlush;
    const flush = vi.fn(() => new Promise((resolve) => (releaseFlush = resolve)));
    const view = mount({ flush });
    await waitUntilReady();

    act(() => {
      adapter.handler(
        request(
          "workspace.applyLayout",
          { layout: { type: "panel", panelId: "spectrum" } },
          "first"
        )
      );
      adapter.handler(request("app.inspect", {}, "second"));
    });
    await waitFor(() => expect(releaseFlush).toBeTypeOf("function"));
    expect(adapter.responses).toHaveLength(0);

    view.unmount();
    releaseFlush();
    await Promise.resolve();
    await Promise.resolve();
    expect(adapter.responses).toHaveLength(0);
  });
});
