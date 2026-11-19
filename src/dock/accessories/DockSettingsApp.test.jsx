/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DockSettingsApp } from "./DockSettingsApp.jsx";

const events = vi.hoisted(() => ({
  receive: null,
  send: vi.fn(async (event) => event),
  resolve: vi.fn(),
  reject: vi.fn(),
}));

vi.mock("../../ipc/dockAccessoryEvents.js", () => ({
  emitDockAccessoryAction: events.send,
  emitDockAccessoryReady: async () => {},
  listenDockAccessoryState: async (receive) => {
    events.receive = receive;
    return () => {};
  },
  listenDockAccessoryAction: async () => () => {},
}));
vi.mock("./useAuthoringLayout.js", () => ({ useAuthoringLayout: () => {} }));
vi.mock("./useAccessoryTargetReport.js", () => ({ useAccessoryTargetReport: () => {} }));
vi.mock("../../components/SettingsContent.jsx", () => ({
  SettingsContent: ({ interfaceSize, setInterfaceSize, onExportConfiguration }) => (
    <>
      <button onClick={() => void setInterfaceSize("large").then(events.resolve, events.reject)}>
        Size: {interfaceSize}
      </button>
      <button onClick={() => void onExportConfiguration().then(events.resolve, events.reject)}>
        Export
      </button>
    </>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => vi.useRealTimers());

function snapshot(revision, session, reply = null) {
  act(() =>
    events.receive({
      revision,
      surface: "dock-settings",
      payload: {
        session,
        view: "settings",
        reply,
        snapshot: {
          values: { interfaceSize: "default" },
          actions: ["setInterfaceSize", "onExportConfiguration"],
        },
      },
    })
  );
}

async function startAction(button) {
  await act(async () => render(<DockSettingsApp />));
  snapshot(1, "original");
  fireEvent.click(screen.getByRole("button", { name: button }));
  const [event] = events.send.mock.calls.find(([event]) => event.type === "settings-action");
  return { sequence: event.payload.sequence, session: "original" };
}

it("expires an acknowledged action even if later snapshots repeat the acknowledgement", async () => {
  const action = await startAction("Size: default");
  expect(screen.getByRole("button", { name: "Size: large" })).toBeTruthy();
  snapshot(2, "original", { ...action, pending: true });
  await act(async () => vi.advanceTimersByTimeAsync(25_000));
  snapshot(3, "original", { ...action, pending: true });
  await act(async () => vi.advanceTimersByTimeAsync(6_000));

  expect(events.reject).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining("timed out") })
  );
  expect(screen.getByRole("alert").textContent).toMatch(/timed out/);
  expect(screen.getByRole("button", { name: "Size: default" })).toBeTruthy();
});

it("allows native file dialogs to take longer than ordinary Settings actions", async () => {
  const action = await startAction("Export");
  snapshot(2, "original", { ...action, pending: true });
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(events.reject).not.toHaveBeenCalled();
  snapshot(3, "original", { ...action, value: "written" });
  await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
  expect(events.resolve).toHaveBeenCalledWith("written");
  expect(events.reject).not.toHaveBeenCalled();
});

it.each([false, true])(
  "retires an idle host after a session change without a final reply (acknowledged: %s)",
  async (acknowledged) => {
    const action = await startAction("Size: default");
    if (acknowledged) snapshot(2, "original", { ...action, pending: true });
    snapshot(3, null);
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    snapshot(4, null, { ...action, pending: true });
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    expect(events.reject).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Settings session changed." })
    );
    expect(events.send).toHaveBeenCalledWith(expect.objectContaining({ type: "settings-idle" }));
  }
);

it("honors a final reply that arrives just after the session closes", async () => {
  const action = await startAction("Size: default");
  snapshot(2, null, { ...action, pending: true });
  snapshot(3, null, { ...action, value: "saved" });
  await act(async () => vi.advanceTimersByTimeAsync(4_000));

  expect(events.resolve).toHaveBeenCalledWith("saved");
  expect(events.reject).not.toHaveBeenCalled();
});
