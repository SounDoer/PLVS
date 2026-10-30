/** @vitest-environment jsdom */
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickTour } from "./QuickTour.jsx";
import { BlockingEditorsProvider, useBlockingEditor } from "../hooks/BlockingEditorsContext.jsx";
import { settingsStore } from "../persistence/index.js";

vi.mock("../lib/runtimeRole.js", () => ({ useCoordinatorRole: () => role.coordinator }));
const role = vi.hoisted(() => ({ coordinator: true }));

let frameTime = 0;
let frameQueue;
async function sample() {
  await act(async () => {
    frameTime += 120;
    const callbacks = [...frameQueue.values()];
    frameQueue.clear();
    callbacks.forEach((callback) => callback(frameTime));
  });
}

async function settle() {
  await sample();
  await sample();
  await sample();
}

const BASE = {
  running: false,
  snapshot: false,
  hasHistory: false,
  sourceMode: "live",
  docked: false,
  dockSupported: true,
  applicationsSupported: true,
  settingsOpen: false,
  updateSetupPending: false,
};

function mount(props = {}) {
  return render(
    <BlockingEditorsProvider>
      <QuickTour {...BASE} {...props} />
    </BlockingEditorsProvider>
  );
}

async function start() {
  fireEvent.click(screen.getByRole("button", { name: "Start Tour" }));
  await act(async () => {});
  await sample();
}

function target(name, rect = { left: 20, top: 20, right: 50, bottom: 50, width: 30, height: 30 }) {
  const element = document.createElement("button");
  element.dataset.tourTarget = name;
  element.textContent = name;
  element.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, toJSON() {} });
  document.body.append(element);
  return element;
}

beforeEach(() => {
  frameTime = 0;
  vi.spyOn(performance, "now").mockImplementation(() => frameTime);
  role.coordinator = true;
  settingsStore.reset();
  settingsStore.patch({ quickTour: "pending", untouchedSetting: 17 });
  frameQueue = new Map();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    frameQueue.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (frame) => frameQueue.delete(frame));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Quick Tour", () => {
  it("waits for update setup, supports declining, and does not repeat on remount", async () => {
    const view = mount({ updateSetupPending: true });
    expect(screen.queryByText("Start Tour")).toBeNull();
    view.rerender(
      <BlockingEditorsProvider>
        <QuickTour {...BASE} />
      </BlockingEditorsProvider>
    );
    fireEvent.click(screen.getByText("Not Now"));
    await act(async () => {});
    expect(settingsStore.read().quickTour).toBe("dismissed");
    view.unmount();
    mount();
    expect(screen.queryByText("Start Tour")).toBeNull();
    expect(settingsStore.read().untouchedSetting).toBe(17);
  });

  it("never automatically invites established or participant workbenches", () => {
    settingsStore.patch({ quickTour: "dismissed" });
    const view = mount();
    expect(screen.queryByText("Start Tour")).toBeNull();
    view.unmount();
    settingsStore.patch({ quickTour: "pending" });
    role.coordinator = false;
    mount();
    expect(screen.queryByText("Start Tour")).toBeNull();
  });

  it("finishes without requiring capture, a Snapshot, or any setting changes", async () => {
    const action = target("transport");
    const onStart = vi.fn();
    action.onclick = onStart;
    mount();
    await start();
    for (let step = 1; step < 10; step++) fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Finish"));
    await act(async () => {});
    expect(settingsStore.read()).toMatchObject({ quickTour: "completed", untouchedSetting: 17 });
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("keeps the application interactive and follows confirmed capture and Snapshot state", async () => {
    const onStart = vi.fn();
    const action = target("transport");
    action.onclick = onStart;
    const view = mount();
    await start();
    fireEvent.click(action);
    expect(onStart).toHaveBeenCalledOnce();
    expect(screen.getByText(/click Start/)).toBeTruthy();
    view.rerender(
      <BlockingEditorsProvider>
        <QuickTour {...BASE} running />
      </BlockingEditorsProvider>
    );
    expect(screen.getByText(/Metering is running/)).toBeTruthy();
    expect(screen.getByText("1 / 10")).toBeTruthy();
    for (let step = 1; step < 8; step++) fireEvent.click(screen.getByText("Next"));
    view.rerender(
      <BlockingEditorsProvider>
        <QuickTour {...BASE} running snapshot />
      </BlockingEditorsProvider>
    );
    await sample();
    expect(screen.getByText(/Click here to return to live/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("close quick tour"));
    await act(async () => {});
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("follows moved targets and chooses another panel when the target is removed", async () => {
    const first = target("panel-settings");
    // Radix marks a visible trigger closed when its menu is closed; that does not hide the button.
    first.dataset.state = "closed";
    const second = target("panel-settings", {
      left: 200,
      top: 100,
      right: 230,
      bottom: 130,
      width: 30,
      height: 30,
    });
    mount();
    await start();
    for (let step = 1; step < 7; step++) fireEvent.click(screen.getByText("Next"));
    await sample();
    expect(document.querySelector("[data-tour-highlight]").getAttribute("style")).toContain(
      "left: 18px"
    );
    first.remove();
    await sample();
    expect(document.querySelector("[data-tour-highlight]").getAttribute("style")).toContain(
      "left: 198px"
    );
    second.getBoundingClientRect = () => ({
      left: 400,
      top: 100,
      right: 430,
      bottom: 130,
      width: 30,
      height: 30,
      x: 400,
      y: 100,
      toJSON() {},
    });
    await sample();
    expect(document.querySelector("[data-tour-highlight]").getAttribute("style")).toContain(
      "left: 398px"
    );
    second.remove();
    await sample();
    expect(screen.getByText(/No panel settings control is visible/)).toBeTruthy();
    expect(screen.getByText("Next").hasAttribute("disabled")).toBe(false);
  });

  it("automatically returns to the same step after a menu closes without reclaiming focus", async () => {
    target("transport");
    mount();
    await start();
    const menu = target("test-menu");
    menu.setAttribute("role", "menu");
    menu.style.opacity = "0";
    await sample();
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByText("Resume Tour")).toBeNull();
    settingsStore.patch({ untouchedSetting: 42 });
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    menu.remove();
    await sample();
    expect(screen.queryByRole("region")).toBeNull();
    await settle();
    expect(screen.getByText("Start Monitoring")).toBeTruthy();
    expect(screen.getByText("1 / 10")).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(screen.queryByText("Resume Tour")).toBeNull();
    expect(settingsStore.read().untouchedSetting).toBe(42);
  });

  it("waits for blocking drafts without closing or modifying them", async () => {
    let setEditor;
    function Fixture() {
      const [open, setOpen] = useState(false);
      setEditor = setOpen;
      useBlockingEditor("test-draft", open);
      return <QuickTour {...BASE} />;
    }
    render(
      <BlockingEditorsProvider>
        <Fixture />
      </BlockingEditorsProvider>
    );
    await start();
    act(() => setEditor(true));
    await sample();
    expect(screen.queryByText("Resume Tour")).toBeNull();
    act(() => setEditor(false));
    await settle();
    expect(screen.getByText("Start Monitoring")).toBeTruthy();
    expect(screen.queryByText("Resume Tour")).toBeNull();
  });

  it("manually replays from step one after Settings closes and respects File mode", async () => {
    settingsStore.patch({ quickTour: "completed" });
    const view = mount({ requestId: 1, settingsOpen: true });
    await sample();
    expect(screen.queryByRole("region")).toBeNull();
    view.rerender(
      <BlockingEditorsProvider>
        <QuickTour {...BASE} requestId={1} />
      </BlockingEditorsProvider>
    );
    await settle();
    expect(screen.getByText("1 / 10")).toBeTruthy();
    view.rerender(
      <BlockingEditorsProvider>
        <QuickTour {...BASE} requestId={1} sourceMode="file" />
      </BlockingEditorsProvider>
    );
    await sample();
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByText("Resume Tour")).toBeNull();
    view.rerender(
      <BlockingEditorsProvider>
        <QuickTour {...BASE} requestId={1} />
      </BlockingEditorsProvider>
    );
    await settle();
    expect(screen.getByText("1 / 10")).toBeTruthy();
  });

  it("does not flash the card between a menu and a nested editor, or reopen after dismissal", async () => {
    mount();
    await start();
    fireEvent.click(screen.getByText("Next"));
    const menu = target("menu");
    menu.setAttribute("role", "menu");
    await sample();
    menu.remove();
    await sample();
    expect(screen.queryByRole("region")).toBeNull();
    const editor = target("editor");
    editor.setAttribute("role", "dialog");
    await settle();
    expect(screen.queryByRole("region")).toBeNull();
    editor.remove();
    await settle();
    expect(screen.getByText("Choose Your Source")).toBeTruthy();
    expect(screen.getByText("2 / 10")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("close quick tour"));
    await act(async () => {});
    const anotherMenu = target("menu");
    anotherMenu.setAttribute("role", "menu");
    await sample();
    anotherMenu.remove();
    await settle();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("introduces Clear and Settings separately without invoking either control", async () => {
    const clear = target("clear");
    const settings = target("settings");
    const onClear = vi.fn();
    const onSettings = vi.fn();
    clear.onclick = onClear;
    settings.onclick = onSettings;
    mount();
    await start();
    for (let step = 1; step < 9; step++) fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Clear Measurement")).toBeTruthy();
    expect(screen.getByText("9 / 10")).toBeTruthy();
    expect(screen.queryByText("Finish")).toBeNull();
    expect(document.querySelectorAll("[data-tour-highlight]")).toHaveLength(1);
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Application Settings")).toBeTruthy();
    expect(screen.getByText("10 / 10")).toBeTruthy();
    expect(screen.getByText("Finish")).toBeTruthy();
    expect(document.querySelectorAll("[data-tour-highlight]")).toHaveLength(1);
    expect(onClear).not.toHaveBeenCalled();
    expect(onSettings).not.toHaveBeenCalled();
  });
});
