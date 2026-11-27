/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TrayWorkbenchPanel } from "./TrayWorkbenchPanel.jsx";
import { TRAY_WORKBENCH_ACTION, TRAY_WORKBENCH_STATE } from "./trayWorkbenchProtocol.js";

vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mainBounds = { left: 0, top: 0, width: 320, height: 400 };
const pickerBounds = { left: 326, top: 160, width: 320, height: 140 };

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
  vi.mocked(invoke).mockImplementation(async (command, args) =>
    command === "layout_tray_workbench_panel"
      ? { main: mainBounds, side: args && "side" in args && args.side ? pickerBounds : null }
      : undefined
  );
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
  fireEvent.click(await options.findByRole("button", { name: "Speakers" }));
  expect(emitTo).toHaveBeenCalledWith("main", TRAY_WORKBENCH_ACTION, {
    kind: "activate",
    key: "Speakers",
  });

  await publish([peer("Speakers")]);
  expect(options.getByRole("button", { name: "Speakers", pressed: true })).toBeTruthy();
  fireEvent.click(options.getByRole("button", { name: /^Output/ }));
  expect(
    await options.findByRole("button", { name: /Output.*Speakers/, expanded: false })
  ).toBeTruthy();
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

it("opens only pickers on mouse dwell and keeps the current picker open during diagonal entry", async () => {
  vi.useFakeTimers();
  const { publish } = await openTray();
  await publish([peer("Automatic")]);
  const workbench = screen.getByRole("button", { name: "Peer Workbench" });
  const mouse = { pointerType: "mouse" };
  const advance = (ms) => act(async () => vi.advanceTimersByTimeAsync(ms));

  fireEvent.pointerOver(workbench, mouse);
  await advance(400);
  expect(workbench.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(workbench);
  const source = screen.getByRole("button", { name: "Source" });
  const preset = screen.getByRole("button", { name: "Preset" });

  fireEvent.pointerOver(source, mouse);
  await advance(100);
  expect(source.getAttribute("aria-expanded")).toBe("false");
  fireEvent.pointerOut(source, mouse);
  await advance(400);
  expect(source.getAttribute("aria-expanded")).toBe("false");
  fireEvent.pointerOver(source, mouse);
  await advance(220);
  const side = screen.getByRole("region", { name: "Source" });
  expect(side.contains(document.activeElement)).toBe(false);
  fireEvent.click(source, { detail: 1 });
  expect(source.getAttribute("aria-expanded")).toBe("true");

  fireEvent.pointerOut(source, { ...mouse, relatedTarget: preset });
  await advance(100);
  fireEvent.pointerOut(preset, mouse);
  await advance(100);
  fireEvent.pointerOver(side, mouse);
  await advance(400);
  expect(screen.getByRole("region", { name: "Source" })).toBe(side);
  expect(preset.getAttribute("aria-expanded")).toBe("false");

  fireEvent.pointerOut(side, mouse);
  await advance(200);
  expect(source.getAttribute("aria-expanded")).toBe("true");
  await advance(200);
  expect(source.getAttribute("aria-expanded")).toBe("false");
  expect(workbench.getAttribute("aria-expanded")).toBe("true");
  fireEvent.pointerOver(preset, mouse);
  await advance(220);
  expect(screen.getByRole("region", { name: "Preset" })).toBeTruthy();
});

it("cancels a pending picker on Escape or a new Tray presentation", async () => {
  vi.useFakeTimers();
  const { hide, publish } = await openTray();
  const items = [source("Automatic")];
  await publish(items);
  const trigger = screen.getByRole("button", { name: "Source" });
  const mouse = { pointerType: "mouse" };

  fireEvent.pointerOver(trigger, mouse);
  fireEvent.keyDown(window, { key: "Escape" });
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(hide).toHaveBeenCalledOnce();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");

  fireEvent.pointerOver(trigger, mouse);
  await publish(items, 2);
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger, { detail: 1 });
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
});

it("keeps the visible picker and group unchanged until their replacement layout arrives", async () => {
  const { publish } = await openTray();
  await publish(peer("Automatic").items);
  fireEvent.click(screen.getByRole("button", { name: "Source" }));
  const side = await screen.findByRole("region", { name: "Source" });

  function holdNextLayout() {
    let resolveLayout;
    const layout = new Promise((resolve) => {
      resolveLayout = resolve;
    });
    vi.mocked(invoke).mockReturnValueOnce(layout);
    return () => act(async () => resolveLayout({ main: mainBounds, side: pickerBounds }));
  }

  const finishGroupLayout = holdNextLayout();
  fireEvent.click(within(side).getByRole("button", { name: /^Output/ }));
  expect(within(side).getByRole("button", { name: /^Output/, expanded: false })).toBeTruthy();
  expect(within(side).queryByRole("button", { name: "Speakers" })).toBeNull();
  await finishGroupLayout();
  expect(within(side).getByRole("button", { name: "Speakers" })).toBeTruthy();

  const finishPickerLayout = holdNextLayout();
  fireEvent.click(screen.getByRole("button", { name: "Preset" }));
  expect(screen.getByRole("region", { name: "Source" })).toBe(side);
  expect(screen.queryByRole("region", { name: "Preset" })).toBeNull();
  await finishPickerLayout();
  expect(screen.getByRole("region", { name: "Preset" })).toBe(side);
  expect(screen.queryByRole("region", { name: "Source" })).toBeNull();
});

it("renders the shared Source labels and current Preset dot in selection-only rows", async () => {
  const { publish } = await openTray();
  const sourceMenu = source("Speakers");
  Object.assign(sourceMenu.items[1].items[0], {
    text: "Speakers (Interface)",
    display: { primary: "Speakers", secondary: "Interface" },
  });
  const presetMenu = peer("Automatic").items.at(-1);
  Object.assign(presetMenu.items[0], {
    checked: true,
    text: "Mixing (modified)",
    display: { primary: "Mixing", modified: true },
  });
  await publish([sourceMenu, presetMenu]);
  fireEvent.click(screen.getByRole("button", { name: "Source" }));
  const sources = within(await screen.findByRole("region", { name: "Source" }));
  const group = sources.getByRole("button", { name: /Output.*Speakers, selected/ });
  expect(within(group).queryByText("Interface")).toBeNull();
  expect(group.querySelector(".bg-primary")).toBeTruthy();
  fireEvent.click(group);
  const device = await sources.findByRole("button", {
    name: "Speakers (Interface)",
    pressed: true,
  });
  expect(within(device).getByText("Speakers")).toBeTruthy();
  expect(within(device).getByText("Interface")).toBeTruthy();
  expect(device.querySelector(".bg-primary")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Preset" }));
  const presets = within(await screen.findByRole("region", { name: "Preset" }));
  const preset = presets.getByRole("button", { name: "Mixing (modified)", pressed: true });
  expect(preset.textContent).toBe("Mixing *");
  expect(preset.querySelector(".bg-primary")).toBeTruthy();
  expect(presets.getAllByRole("button")).toEqual([preset]);
});
