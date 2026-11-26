/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TrayWorkbenchPanel } from "./TrayWorkbenchPanel.jsx";
import { TRAY_WORKBENCH_ACTION, TRAY_WORKBENCH_STATE } from "./trayWorkbenchProtocol.js";

vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (_command, { side }) => ({
    main: { left: 0, top: 0, width: 320, height: 400 },
    side: side ? { left: 326, top: 160, width: 320, height: 140 } : null,
  })),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

function source(checked) {
  const choice = (text) => ({
    kind: "check",
    key: text,
    text,
    checked: text === checked,
    dismiss: false,
  });
  return {
    key: "workbench:peer:source",
    kind: "submenu",
    pageTitle: "Source",
    text: `Source: ${checked}`,
    items: [
      choice("Automatic"),
      { kind: "group", key: "output", text: "Output", items: [choice("Speakers")] },
      { kind: "group", key: "apps", text: "Applications", items: [choice("Browser")] },
    ],
  };
}

function peer(checked) {
  return {
    key: "workbench:peer",
    kind: "submenu",
    text: "Peer Workbench",
    items: [
      { key: "locate", text: "Locate" },
      source(checked),
      {
        key: "workbench:peer:preset",
        kind: "submenu",
        pageTitle: "Preset",
        text: "Preset: None",
        items: [{ key: "mixing", text: "Mixing", kind: "check", dismiss: false }],
      },
    ],
  };
}

async function openTray() {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.mocked(listen).mockResolvedValue(() => {});
  const hide = vi.fn();
  vi.mocked(getCurrentWindow).mockReturnValue(
    /** @type {ReturnType<typeof getCurrentWindow>} */ (/** @type {unknown} */ ({ hide }))
  );
  render(<TrayWorkbenchPanel />);
  const receive = vi.mocked(listen).mock.calls.find(([event]) => event === TRAY_WORKBENCH_STATE)[1];
  return {
    hide,
    publish: (items, presentation = 1) =>
      act(async () =>
        receive({
          event: TRAY_WORKBENCH_STATE,
          id: 0,
          payload: { items, interfaceSize: "default", presentation },
        })
      ),
  };
}

it("keeps Locate visible alongside Source and expands its groups independently", async () => {
  const { hide, publish } = await openTray();
  await publish([peer("Automatic")]);
  fireEvent.click(screen.getByRole("button", { name: "Peer Workbench" }));
  const trigger = screen.getByRole("button", { name: "Source" });
  fireEvent.click(trigger);

  const side = await screen.findByRole("region", { name: "Source" });
  const options = within(side);
  const locate = screen.getByRole("button", { name: "Locate" });
  fireEvent.click(locate);
  expect(emitTo).toHaveBeenCalledWith("main", TRAY_WORKBENCH_ACTION, {
    kind: "activate",
    key: "locate",
  });
  expect(options.getByRole("button", { name: /^Output/, expanded: false })).toBeTruthy();
  expect(options.queryByRole("button", { name: "Speakers" })).toBeNull();
  fireEvent.click(options.getByRole("button", { name: /^Output/ }));
  expect(options.getByRole("button", { name: /^Applications/, expanded: false })).toBeTruthy();
  fireEvent.click(options.getByRole("button", { name: "Speakers" }));
  expect(emitTo).toHaveBeenCalledWith("main", TRAY_WORKBENCH_ACTION, {
    kind: "activate",
    key: "Speakers",
  });

  await publish([peer("Speakers")]);
  expect(options.getByRole("button", { name: "Speakers", pressed: true })).toBeTruthy();
  fireEvent.click(options.getByRole("button", { name: /^Output/ }));
  expect(options.getByRole("button", { name: /Output.*Speakers/, expanded: false })).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(hide).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "Source" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("button", { name: "Locate" })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Peer Workbench" }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(hide).toHaveBeenCalledOnce();
});

it("switches the side menu directly and resets it when the tray reopens", async () => {
  const { publish } = await openTray();
  const presets = peer("Automatic").items.at(-1);
  await publish([source("Automatic"), presets]);
  fireEvent.click(screen.getByRole("button", { name: "Source" }));
  expect(await screen.findByRole("region", { name: "Source" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Preset" }));
  expect(await screen.findByRole("region", { name: "Preset" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Source" })).toBeNull();

  await publish([source("Automatic"), presets], 2);
  expect(screen.queryByRole("region", { name: "Preset" })).toBeNull();
  expect(screen.getByRole("button", { name: "Source", expanded: false })).toBeTruthy();
});
