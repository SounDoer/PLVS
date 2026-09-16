# Tray Menu Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tray menu's Pin/Unpin and (on Windows) Show/Hide items with an input-device switcher and a presets switcher, keeping a platform-conditional Show/Hide on macOS.

**Architecture:** All changes live in one cohesive hook, `src/hooks/useTray.js`, plus its test and the single call site in `src/App.jsx`. The menu is a full-rebuild snapshot (unchanged approach). Two submenus (`Device:` and `Presets`) are built by extracted helpers. Platform is detected with the existing `isMacOS()` helper — no new dependency. Because nearly every line of `buildMenu` and the hook's effects changes, the hook and its test are rewritten wholesale (red test suite → green implementation → wire the call site → verify).

**Tech Stack:** React 19 hooks, `@tauri-apps/api/menu` (`Menu`, `Submenu`, `MenuItem`, `CheckMenuItem`, `PredefinedMenuItem`), Vitest + `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-07-25-tray-menu-redesign-design.md`

---

## File Structure

- **Modify — `src/hooks/useTray.js`:** new interface (drop `pinned`/`togglePin`/`deviceName`; add device + presets inputs), platform-conditional Show/Hide, `Device:` and `Presets` submenus, revised `updateBusy` gating. Extract `deviceLabelFor`, `buildDeviceSubmenu`, `buildPresetsSubmenu`, `buildMenu`.
- **Modify — `src/hooks/useTray.test.js`:** new mocks (`Submenu`, `CheckMenuItem`, `../lib/platform.js`, `../lib/audioDeviceLabels.js`), new `defaultProps`, new behavioural tests, keep the icon/lifecycle tests.
- **Modify — `src/App.jsx`:** change the `useTray({...})` call (~line 1251) to the new props. Leave the `deviceName` memo untouched (the footer still uses it).

No new files. No Rust changes. No new dependencies.

---

## Task 1: Rewrite the test suite to the new interface (red)

**Files:**
- Test: `src/hooks/useTray.test.js` (full rewrite)

- [ ] **Step 1: Replace the whole test file with the new suite**

Overwrite `src/hooks/useTray.test.js` with:

```js
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";

vi.mock("@tauri-apps/api/tray", () => ({
  TrayIcon: {
    getById: vi.fn().mockResolvedValue(null),
    removeById: vi.fn().mockResolvedValue(undefined),
    new: vi.fn().mockResolvedValue({ setMenu: vi.fn(), close: vi.fn() }),
  },
}));
vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: vi.fn().mockResolvedValue({}) },
  Submenu: { new: vi.fn().mockResolvedValue({}) },
  MenuItem: { new: vi.fn().mockResolvedValue({}) },
  CheckMenuItem: { new: vi.fn().mockResolvedValue({}) },
  PredefinedMenuItem: { new: vi.fn().mockResolvedValue({}) },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isVisible: vi.fn().mockResolvedValue(true) }),
}));
vi.mock("@tauri-apps/api/image", () => ({
  Image: { fromPath: vi.fn().mockResolvedValue({ __type: "MockImage" }) },
}));
vi.mock("@tauri-apps/api/path", () => ({
  resolveResource: vi.fn().mockResolvedValue("/fake/tray.png"),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ exit: vi.fn() }));
vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../lib/platform.js", () => ({ isMacOS: vi.fn(() => false) }));
vi.mock("../lib/audioDeviceLabels.js", () => ({
  formatAudioDeviceLabel: (label) => label,
}));

import { closeTrayIcon, PLVS_TRAY_ID } from "../lib/trayIconLifecycle.js";
import { useTray } from "./useTray.js";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Image } from "@tauri-apps/api/image";
import { MenuItem, CheckMenuItem, Submenu } from "@tauri-apps/api/menu";
import { resolveResource } from "@tauri-apps/api/path";
import { exit } from "@tauri-apps/plugin-process";
import { isMacOS } from "../lib/platform.js";

const defaultProps = {
  running: false,
  onStartClick: vi.fn(),
  onToggleWindow: vi.fn(),
  colorScheme: "dark",
  updateBusy: false,
  audioOutputs: [],
  audioInputs: [],
  safeAudioDeviceId: "default",
  defaultOutputLabel: "",
  onSelectDevice: vi.fn(),
  presets: { list: [], activeId: null, dirty: false, apply: vi.fn() },
};

// Collects the options object passed to every top-level MenuItem.new call.
const menuItemOptions = () => MenuItem.new.mock.calls.map(([o]) => o);
const checkItemOptions = () => CheckMenuItem.new.mock.calls.map(([o]) => o);
const submenuOptions = () => Submenu.new.mock.calls.map(([o]) => o);
const findText = (options, text) => options.find((o) => o.text === text);

describe("useTray", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isMacOS.mockReturnValue(false);
    TrayIcon.getById.mockResolvedValue(null);
    TrayIcon.removeById.mockResolvedValue(undefined);
    TrayIcon.new.mockResolvedValue({ setMenu: vi.fn(), close: vi.fn() });
  });

  afterEach(() => vi.clearAllMocks());

  it("creates TrayIcon with the loaded icon (dark theme)", async () => {
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(resolveResource).toHaveBeenCalledWith("icons/tray-dark.png");
    expect(Image.fromPath).toHaveBeenCalledWith("/fake/tray.png");
    expect(TrayIcon.new).toHaveBeenCalledWith(
      expect.objectContaining({ id: PLVS_TRAY_ID, icon: { __type: "MockImage" } })
    );
  });

  it("creates TrayIcon with the light theme icon", async () => {
    renderHook(() => useTray({ ...defaultProps, colorScheme: "light" }));
    await act(async () => {});
    expect(resolveResource).toHaveBeenCalledWith("icons/tray-light.png");
    expect(TrayIcon.new).toHaveBeenCalledWith(
      expect.objectContaining({ icon: { __type: "MockImage" } })
    );
  });

  it("creates TrayIcon with iconAsTemplate true", async () => {
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(TrayIcon.new).toHaveBeenCalledWith(expect.objectContaining({ iconAsTemplate: true }));
  });

  it("removes any existing singleton tray before creating a new one", async () => {
    const existingClose = vi.fn();
    TrayIcon.getById.mockResolvedValue({ close: existingClose });
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(TrayIcon.getById).toHaveBeenCalledWith(PLVS_TRAY_ID);
    expect(existingClose).toHaveBeenCalledTimes(1);
    expect(TrayIcon.removeById).toHaveBeenCalledWith(PLVS_TRAY_ID);
    expect(TrayIcon.new).toHaveBeenCalledWith(expect.objectContaining({ id: PLVS_TRAY_ID }));
  });

  it("keeps the tray click action wired to the latest window toggle callback", async () => {
    const firstToggleWindow = vi.fn();
    const secondToggleWindow = vi.fn();
    const { rerender } = renderHook(
      ({ onToggleWindow }) => useTray({ ...defaultProps, onToggleWindow }),
      { initialProps: { onToggleWindow: firstToggleWindow } }
    );
    await act(async () => {});
    const trayAction = TrayIcon.new.mock.calls[0][0].action;
    rerender({ onToggleWindow: secondToggleWindow });
    await act(async () => {});
    trayAction({ type: "Click", button: "Left" });
    expect(firstToggleWindow).not.toHaveBeenCalled();
    expect(secondToggleWindow).toHaveBeenCalledTimes(1);
  });

  it("omits Show/Hide and Pin items on Windows", async () => {
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    const texts = menuItemOptions().map((o) => o.text);
    expect(texts).not.toContain("Hide Window");
    expect(texts).not.toContain("Show Window");
    expect(texts).not.toContain("Pin Window");
    expect(texts).not.toContain("Unpin Window");
  });

  it("includes a platform Show/Hide item on macOS", async () => {
    isMacOS.mockReturnValue(true);
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    // isVisible mock resolves true -> "Hide Window"
    expect(findText(menuItemOptions(), "Hide Window")).toBeTruthy();
  });

  it("builds the Device submenu with the current device labelled and checked", async () => {
    const onSelectDevice = vi.fn();
    renderHook(() =>
      useTray({
        ...defaultProps,
        onSelectDevice,
        safeAudioDeviceId: "mic-1",
        audioOutputs: [{ id: "out-1", label: "Speakers", isSystemOutputMonitor: true }],
        audioInputs: [{ id: "mic-1", label: "USB Mic" }],
      })
    );
    await act(async () => {});

    // Parent label reflects the selected device.
    expect(findText(submenuOptions(), "Device: USB Mic")).toBeTruthy();

    // Group headers present (disabled MenuItems).
    const headers = menuItemOptions();
    expect(findText(headers, "Output")).toMatchObject({ enabled: false });
    expect(findText(headers, "Input")).toMatchObject({ enabled: false });

    // The selected device's CheckMenuItem is checked; Automatic is not.
    const checks = checkItemOptions();
    expect(findText(checks, "USB Mic")).toMatchObject({ checked: true });
    expect(findText(checks, "Automatic (default system output)")).toMatchObject({
      checked: false,
    });

    // Clicking a device forwards its id.
    findText(checks, "Speakers").action();
    expect(onSelectDevice).toHaveBeenCalledWith("out-1");
  });

  it("labels the Device parent Automatic and checks it when default is selected", async () => {
    renderHook(() =>
      useTray({ ...defaultProps, safeAudioDeviceId: "default", defaultOutputLabel: "" })
    );
    await act(async () => {});
    expect(findText(submenuOptions(), "Device: Automatic")).toBeTruthy();
    expect(findText(checkItemOptions(), "Automatic (default system output)")).toMatchObject({
      checked: true,
    });
  });

  it("uses the resolved default output label in the Device parent when available", async () => {
    renderHook(() =>
      useTray({ ...defaultProps, safeAudioDeviceId: "default", defaultOutputLabel: "Realtek" })
    );
    await act(async () => {});
    expect(findText(submenuOptions(), "Device: Realtek")).toBeTruthy();
  });

  it("builds the Presets submenu with the active preset checked and dirty marked", async () => {
    const apply = vi.fn();
    renderHook(() =>
      useTray({
        ...defaultProps,
        presets: {
          list: [
            { id: "p1", name: "Mixing" },
            { id: "p2", name: "Mastering" },
          ],
          activeId: "p2",
          dirty: true,
          apply,
        },
      })
    );
    await act(async () => {});
    const checks = checkItemOptions();
    expect(findText(checks, "Mixing")).toMatchObject({ checked: false });
    expect(findText(checks, "Mastering (modified)")).toMatchObject({ checked: true });
    findText(checks, "Mixing").action();
    expect(apply).toHaveBeenCalledWith("p1");
  });

  it("shows a disabled No presets item when the list is empty", async () => {
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(findText(menuItemOptions(), "No presets")).toMatchObject({ enabled: false });
  });

  it("disables Presets and Quit but not Start/Stop or Device while updating (macOS)", async () => {
    isMacOS.mockReturnValue(true);
    const setMenu = vi.fn();
    const onToggleWindow = vi.fn();
    TrayIcon.new.mockResolvedValue({ setMenu, close: vi.fn() });
    const { rerender } = renderHook(
      ({ updateBusy }) => useTray({ ...defaultProps, onToggleWindow, updateBusy }),
      { initialProps: { updateBusy: false } }
    );
    await act(async () => {});
    const trayAction = TrayIcon.new.mock.calls[0][0].action;
    const staleQuit = findText(menuItemOptions(), "Quit").action;
    MenuItem.new.mockClear();
    Submenu.new.mockClear();

    rerender({ updateBusy: true });
    await act(async () => {});

    const items = menuItemOptions();
    const subs = submenuOptions();
    expect(findText(items, "Hide Window")).toMatchObject({ enabled: false });
    expect(findText(items, "Quit")).toMatchObject({ enabled: false });
    expect(findText(subs, "Presets")).toMatchObject({ enabled: false });
    // Start/Stop is never gated.
    expect(findText(items, "Start")).not.toMatchObject({ enabled: false });
    // Device submenu is never gated.
    expect(findText(subs, "Device: Automatic")).not.toMatchObject({ enabled: false });
    expect(setMenu).toHaveBeenCalled();

    // Double-guard: stale gated callbacks are no-ops while busy.
    trayAction({ type: "Click", button: "Left" });
    expect(onToggleWindow).not.toHaveBeenCalled();
    staleQuit();
    expect(exit).not.toHaveBeenCalled();
  });

  it("closes an orphaned tray if effect is cancelled before TrayIcon.new resolves", async () => {
    let resolveTrayNew;
    const orphanClose = vi.fn();
    TrayIcon.new.mockImplementation(
      () =>
        new Promise((res) => {
          resolveTrayNew = () => res({ setMenu: vi.fn(), close: orphanClose });
        })
    );
    const { unmount } = renderHook(() => useTray(defaultProps));
    await act(async () => {});
    unmount();
    await act(async () => {
      resolveTrayNew();
    });
    expect(orphanClose).toHaveBeenCalledTimes(1);
  });

  it("closes the singleton tray before a profile reload", async () => {
    const currentClose = vi.fn();
    const existingClose = vi.fn();
    TrayIcon.new.mockResolvedValue({ setMenu: vi.fn(), close: currentClose });
    TrayIcon.getById.mockResolvedValue({ close: existingClose });
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    await closeTrayIcon();
    expect(currentClose).toHaveBeenCalled();
    expect(existingClose).toHaveBeenCalled();
    expect(TrayIcon.removeById).toHaveBeenCalledWith(PLVS_TRAY_ID);
  });
});
```

- [ ] **Step 2: Run the suite and confirm the new tests fail**

Run: `npx vitest run src/hooks/useTray.test.js`
Expected: the icon/lifecycle tests fail too, because the current `useTray.js` imports do not include `Submenu`/`CheckMenuItem` and the current `buildMenu` still emits Pin/Show-Hide. Key expected failures: "omits Show/Hide and Pin items on Windows", "builds the Device submenu…", "builds the Presets submenu…", "disables Presets and Quit but not Start/Stop or Device while updating". This confirms red.

- [ ] **Step 3: Commit the red test**

```bash
git add src/hooks/useTray.test.js
git commit -m "test(tray): specify the redesigned tray menu"
```

---

## Task 2: Rewrite useTray.js to satisfy the suite (green)

**Files:**
- Modify: `src/hooks/useTray.js` (full rewrite)

- [ ] **Step 1: Replace the whole file**

Overwrite `src/hooks/useTray.js` with:

```js
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu, Submenu, MenuItem, CheckMenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Image } from "@tauri-apps/api/image";
import { resolveResource } from "@tauri-apps/api/path";
import { exit } from "@tauri-apps/plugin-process";
import { isTauri } from "../ipc/env.js";
import { isMacOS } from "../lib/platform.js";
import { formatAudioDeviceLabel } from "../lib/audioDeviceLabels.js";
import {
  clearCurrentTrayIcon,
  closeTrayIcon,
  PLVS_TRAY_ID,
  setCurrentTrayIcon,
} from "../lib/trayIconLifecycle.js";

function deviceLabelFor({ safeAudioDeviceId, audioOutputs, audioInputs, defaultOutputLabel }) {
  if (safeAudioDeviceId === "default") {
    return defaultOutputLabel ? formatAudioDeviceLabel(defaultOutputLabel) : "Automatic";
  }
  const match = [...audioOutputs, ...audioInputs].find((d) => d.id === safeAudioDeviceId);
  return match ? formatAudioDeviceLabel(match.label) : "Automatic";
}

async function buildDeviceItems({ audioOutputs, audioInputs, safeAudioDeviceId, onSelectDevice }) {
  const items = [
    await CheckMenuItem.new({
      text: "Automatic (default system output)",
      checked: safeAudioDeviceId === "default",
      action: () => onSelectDevice("default"),
    }),
  ];
  for (const [header, devices] of [
    ["Output", audioOutputs],
    ["Input", audioInputs],
  ]) {
    if (!devices.length) continue;
    items.push(await PredefinedMenuItem.new({ item: "Separator" }));
    items.push(await MenuItem.new({ text: header, enabled: false }));
    for (const d of devices) {
      items.push(
        await CheckMenuItem.new({
          text: formatAudioDeviceLabel(d.label),
          checked: safeAudioDeviceId === d.id,
          action: () => onSelectDevice(d.id),
        })
      );
    }
  }
  return items;
}

async function buildPresetItems({ presetList, presetActiveId, presetDirty, onApplyPreset }) {
  if (!presetList.length) {
    return [await MenuItem.new({ text: "No presets", enabled: false })];
  }
  const items = [];
  for (const p of presetList) {
    const active = p.id === presetActiveId;
    items.push(
      await CheckMenuItem.new({
        text: active && presetDirty ? `${p.name} (modified)` : p.name,
        checked: active,
        action: () => onApplyPreset(p.id),
      })
    );
  }
  return items;
}

async function buildMenu(cfg) {
  const {
    isMac,
    running,
    updateBusy,
    onToggleCapture,
    onToggleWindow,
    onQuit,
    audioOutputs,
    audioInputs,
    safeAudioDeviceId,
    defaultOutputLabel,
    onSelectDevice,
    presetList,
    presetActiveId,
    presetDirty,
    onApplyPreset,
  } = cfg;

  const items = [];

  if (isMac) {
    const isVisible = await getCurrentWindow().isVisible();
    items.push(
      await MenuItem.new({
        text: isVisible ? "Hide Window" : "Show Window",
        enabled: !updateBusy,
        action: onToggleWindow,
      }),
      await PredefinedMenuItem.new({ item: "Separator" })
    );
  }

  items.push(
    await MenuItem.new({
      text: running ? "Stop" : "Start",
      action: onToggleCapture,
    }),
    await PredefinedMenuItem.new({ item: "Separator" }),
    await Submenu.new({
      text: `Device: ${deviceLabelFor({
        safeAudioDeviceId,
        audioOutputs,
        audioInputs,
        defaultOutputLabel,
      })}`,
      items: await buildDeviceItems({
        audioOutputs,
        audioInputs,
        safeAudioDeviceId,
        onSelectDevice,
      }),
    }),
    await Submenu.new({
      text: "Presets",
      enabled: !updateBusy,
      items: await buildPresetItems({ presetList, presetActiveId, presetDirty, onApplyPreset }),
    }),
    await PredefinedMenuItem.new({ item: "Separator" }),
    await MenuItem.new({
      text: "Quit",
      enabled: !updateBusy,
      action: onQuit,
    })
  );

  return Menu.new({ items });
}

export function useTray({
  running,
  onStartClick,
  onToggleWindow,
  colorScheme,
  updateBusy = false,
  audioOutputs = [],
  audioInputs = [],
  safeAudioDeviceId = "default",
  defaultOutputLabel = "",
  onSelectDevice = () => {},
  presets = { list: [], activeId: null, dirty: false, apply: () => {} },
}) {
  const isMac = isMacOS();
  const trayRef = useRef(null);

  const onStartClickRef = useRef(onStartClick);
  const onToggleWindowRef = useRef(onToggleWindow);
  const onSelectDeviceRef = useRef(onSelectDevice);
  const onApplyPresetRef = useRef(presets.apply);
  const updateBusyRef = useRef(updateBusy);
  useLayoutEffect(() => {
    updateBusyRef.current = updateBusy;
  }, [updateBusy]);
  useEffect(() => {
    onStartClickRef.current = onStartClick;
  }, [onStartClick]);
  useEffect(() => {
    onToggleWindowRef.current = onToggleWindow;
  }, [onToggleWindow]);
  useEffect(() => {
    onSelectDeviceRef.current = onSelectDevice;
  }, [onSelectDevice]);
  useEffect(() => {
    onApplyPresetRef.current = presets.apply;
  }, [presets.apply]);

  // Stable callbacks that always call the latest ref.
  const stableToggleCapture = useCallback(() => onStartClickRef.current(), []);
  const stableToggleWindow = useCallback(() => {
    if (!updateBusyRef.current) onToggleWindowRef.current();
  }, []);
  const stableQuit = useCallback(() => {
    if (!updateBusyRef.current) exit(0);
  }, []);
  const stableSelectDevice = useCallback((id) => onSelectDeviceRef.current(id), []);
  const stableApplyPreset = useCallback((id) => {
    if (!updateBusyRef.current) onApplyPresetRef.current(id);
  }, []);

  // Everything buildMenu reads that can change after creation. Refs keep the
  // creation effect current if state changes while TrayIcon.new is pending.
  const menuInputs = {
    isMac,
    running,
    updateBusy,
    audioOutputs,
    audioInputs,
    safeAudioDeviceId,
    defaultOutputLabel,
    presetList: presets.list,
    presetActiveId: presets.activeId,
    presetDirty: presets.dirty,
  };
  const menuInputsRef = useRef(menuInputs);
  useEffect(() => {
    menuInputsRef.current = menuInputs;
  });

  const menuConfig = useCallback(
    (inputs) => ({
      ...inputs,
      onToggleCapture: stableToggleCapture,
      onToggleWindow: stableToggleWindow,
      onQuit: stableQuit,
      onSelectDevice: stableSelectDevice,
      onApplyPreset: stableApplyPreset,
    }),
    [stableToggleCapture, stableToggleWindow, stableQuit, stableSelectDevice, stableApplyPreset]
  );

  // Create tray once on mount.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    (async () => {
      const snapshot = menuInputsRef.current;
      const menu = await buildMenu(menuConfig(snapshot));

      const iconName = colorScheme === "light" ? "icons/tray-light.png" : "icons/tray-dark.png";
      const iconPath = await resolveResource(iconName);
      const icon = await Image.fromPath(iconPath);

      await closeTrayIcon();
      if (cancelled) return;
      const tray = await TrayIcon.new({
        id: PLVS_TRAY_ID,
        icon,
        iconAsTemplate: true,
        tooltip: "PLVS",
        menu,
        menuOnLeftClick: false,
        action: (e) => {
          if (e.type === "Click" && e.button === "Left") {
            stableToggleWindow();
          }
        },
      });

      if (cancelled) {
        tray.close();
      } else {
        setCurrentTrayIcon(tray);
        trayRef.current = tray;
        // State may have changed while the tray was being created; rebuild once
        // with whatever is current so no stale value shows.
        if (menuInputsRef.current !== snapshot) {
          const updatedMenu = await buildMenu(menuConfig(menuInputsRef.current));
          await tray.setMenu(updatedMenu);
        }
      }
    })();

    return () => {
      cancelled = true;
      trayRef.current?.close();
      clearCurrentTrayIcon(trayRef.current);
      trayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild menu when any displayed state changes.
  useEffect(() => {
    if (!isTauri() || !trayRef.current) return;
    (async () => {
      const menu = await buildMenu(menuConfig(menuInputsRef.current));
      // trayRef may have been cleared by unmount cleanup during the await above.
      await trayRef.current?.setMenu(menu);
    })();
  }, [
    menuConfig,
    running,
    updateBusy,
    safeAudioDeviceId,
    defaultOutputLabel,
    audioOutputs,
    audioInputs,
    presets.list,
    presets.activeId,
    presets.dirty,
  ]);

  // Update tray icon when color scheme changes.
  useEffect(() => {
    if (!isTauri() || !trayRef.current) return;
    (async () => {
      const iconName = colorScheme === "light" ? "icons/tray-light.png" : "icons/tray-dark.png";
      const iconPath = await resolveResource(iconName);
      const icon = await Image.fromPath(iconPath);
      await trayRef.current?.setIcon(icon);
    })();
  }, [colorScheme]);
}
```

- [ ] **Step 2: Run the suite and confirm green**

Run: `npx vitest run src/hooks/useTray.test.js`
Expected: PASS, all tests.

- [ ] **Step 3: Lint the hook**

Run: `npx eslint src/hooks/useTray.js`
Expected: no errors. (The single `eslint-disable-next-line` for the mount effect's empty deps is intentional and already present.)

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useTray.js
git commit -m "feat(tray): device switcher and presets in the tray menu"
```

---

## Task 3: Wire the new props at the call site

**Files:**
- Modify: `src/App.jsx` (the `useTray({...})` call, ~line 1251)

- [ ] **Step 1: Read the current call**

Run: `sed -n '1251,1261p' src/App.jsx`
Expected: the call passing `running, pinned, togglePin, onStartClick, deviceName, onToggleWindow, colorScheme, updateBusy`.

- [ ] **Step 2: Replace the call with the new props**

Replace the `useTray({ ... })` call with:

```jsx
  useTray({
    running,
    onStartClick,
    onToggleWindow,
    colorScheme: resolvedTheme.colorScheme,
    updateBusy,
    audioOutputs,
    audioInputs,
    safeAudioDeviceId,
    defaultOutputLabel,
    onSelectDevice: setCaptureDeviceIdAndPersist,
    presets,
  });
```

`audioOutputs`, `audioInputs`, `safeAudioDeviceId` are the memos defined near line 251; `defaultOutputLabel` and `setCaptureDeviceIdAndPersist` come from `useAudioDevices()`; `presets` is the `usePresets(...)` return. All are already in scope at this call site. Do **not** touch the `deviceName` memo (line 857) — the footer still consumes it via `deviceDisplay`/`footerDeviceLabel`.

- [ ] **Step 3: Verify no dropped prop is now orphaned**

Run: `grep -n "togglePin\|pinned" src/App.jsx | head`
Expected: `pinned`/`togglePin` still used by `useAlwaysOnTop` and the window-pin wiring (line ~209 and elsewhere) — they are NOT orphaned by removing them from the tray call. No further edits.

- [ ] **Step 4: Run the App smoke test**

Run: `npx vitest run src/App.smoke.test.jsx`
Expected: PASS. (If it asserts on old tray props, update the assertion to the new interface — but it renders `AppContent`, so a prop rename in the tray call should not break it.)

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(tray): pass device and presets state to the tray hook"
```

---

## Task 4: Full merge gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full check**

Run: `npm run check`
Expected: PASS — version + format + lint + test + build + Rust fmt/clippy/test all green.

- [ ] **Step 2: If format flags the touched files, apply and re-run**

Run: `npm run check`
Expected: PASS with no diff.

- [ ] **Step 3: Remind the user to test the tray by hand**

The tray menu is only exercised in the real app (`npm run desktop`), not by Vitest. After `npm run check` is green, tell the user to run `npm run desktop` and verify: no Pin item; Windows has no Show/Hide (left-click still toggles the window) while macOS keeps it; the `Device:` submenu lists Automatic + Output + Input with the current device checked and switching works; the `Presets` submenu checks the active preset, shows `(modified)` when dirty, and applies on click; during an update the Presets submenu and Quit gray out while Start/Stop and Device stay active.

---

## Self-Review Notes

- **Spec coverage:** platform-conditional Show/Hide (Task 1 tests + Task 2 `isMac` branch); Pin removed (Task 1 test + omission in Task 2); Device submenu grouping/label/check/click (Task 1 tests + `buildDeviceItems`/`deviceLabelFor`); Presets submenu check/dirty/empty/click (Task 1 tests + `buildPresetItems`); update gating rule (Task 1 macOS gating test + `enabled: !updateBusy` on Show/Hide, Presets, Quit only); interface change (Task 3). All spec sections map to a task.
- **Type consistency:** helper names `deviceLabelFor`, `buildDeviceItems`, `buildPresetItems`, `buildMenu` and the `menuConfig`/`menuInputs` shape are identical across Tasks 1–2. Prop names (`audioOutputs`, `audioInputs`, `safeAudioDeviceId`, `defaultOutputLabel`, `onSelectDevice`, `presets`) match between the hook signature (Task 2) and the call site (Task 3).
- **No placeholders:** every code step is complete and runnable.
```
