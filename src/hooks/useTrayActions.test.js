/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTrayActions } from "./useTrayActions.js";

function setup(overrides = {}, updateOverrides = {}) {
  const props = {
    docked: false,
    onShowWindow: vi.fn().mockResolvedValue(undefined),
    exitDockRestoringAttributes: vi.fn().mockResolvedValue({ ok: true }),
    setSettingsOpen: vi.fn(),
    focusUpdateSettings: vi.fn(),
    updateBusy: false,
    updates: {
      enabled: true,
      checkStatus: "idle",
      installStatus: "idle",
      ready: null,
      downloading: false,
      updateInfo: { hasUpdate: false, latestVersion: null },
      openDetails: vi.fn(),
      refreshUpdateCheck: vi.fn().mockResolvedValue(undefined),
      ...updateOverrides,
    },
    ...overrides,
  };
  return { props, ...renderHook(() => useTrayActions(props)) };
}

describe("tray navigation", () => {
  it("reveals a hidden/minimized window before opening Settings", async () => {
    const { props, result } = setup();
    await act(() => result.current.onOpenSettings());
    expect(props.onShowWindow).toHaveBeenCalledOnce();
    expect(props.exitDockRestoringAttributes).not.toHaveBeenCalled();
    expect(props.setSettingsOpen).toHaveBeenCalledWith(true);
    expect(props.onShowWindow.mock.invocationCallOrder[0]).toBeLessThan(
      props.setSettingsOpen.mock.invocationCallOrder[0]
    );
  });

  it("resumes a hidden Dock, restores its normal window, then opens Settings", async () => {
    const { props, result } = setup({ docked: true });
    await act(() => result.current.onOpenSettings());
    expect(props.onShowWindow.mock.invocationCallOrder[0]).toBeLessThan(
      props.exitDockRestoringAttributes.mock.invocationCallOrder[0]
    );
    expect(props.exitDockRestoringAttributes.mock.invocationCallOrder[0]).toBeLessThan(
      props.setSettingsOpen.mock.invocationCallOrder[0]
    );
  });

  it("does not open Settings or start a check if restoring the window fails", async () => {
    const { props, result } = setup({
      docked: true,
      exitDockRestoringAttributes: vi.fn().mockResolvedValue({ ok: false }),
    });
    await act(() => result.current.updateMenu.action());
    expect(props.setSettingsOpen).not.toHaveBeenCalled();
    expect(props.updates.refreshUpdateCheck).not.toHaveBeenCalled();
  });

  it("shows Settings before a manual check so all outcomes have visible feedback", async () => {
    const { props, result } = setup();
    await act(() => result.current.updateMenu.action());
    expect(props.updates.refreshUpdateCheck).toHaveBeenCalledOnce();
    expect(props.focusUpdateSettings).toHaveBeenCalledOnce();
    expect(props.setSettingsOpen.mock.invocationCallOrder[0]).toBeLessThan(
      props.updates.refreshUpdateCheck.mock.invocationCallOrder[0]
    );
    expect(props.updates.openDetails).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "opens existing details with installationSupported=%s",
    async (installationSupported) => {
      const { props, result } = setup(
        { docked: true },
        {
          installationSupported,
          updateInfo: { hasUpdate: true, latestVersion: "1.2.3" },
        }
      );
      await act(() => result.current.updateMenu.action());
      expect(props.onShowWindow).toHaveBeenCalledOnce();
      expect(props.updates.openDetails).toHaveBeenCalledOnce();
      expect(props.updates.refreshUpdateCheck).not.toHaveBeenCalled();
      expect(props.exitDockRestoringAttributes).not.toHaveBeenCalled();
      expect(props.setSettingsOpen).not.toHaveBeenCalled();
      expect(props.focusUpdateSettings).not.toHaveBeenCalled();
    }
  );

  it("disables navigation while the confirmed installer owns the app", async () => {
    const { props, result } = setup({ updateBusy: true });
    await act(() => result.current.onOpenSettings());
    await act(() => result.current.updateMenu.action());
    expect(result.current.updateMenu.enabled).toBe(false);
    expect(props.onShowWindow).not.toHaveBeenCalled();
    expect(props.updates.refreshUpdateCheck).not.toHaveBeenCalled();
  });

  it("does not open Settings if installation begins while the window is being revealed", async () => {
    let finishShow;
    const onShowWindow = vi.fn(
      () =>
        new Promise((resolve) => {
          finishShow = resolve;
        })
    );
    const setSettingsOpen = vi.fn();
    const { result, rerender } = renderHook(
      ({ updateBusy }) =>
        useTrayActions({
          docked: false,
          onShowWindow,
          setSettingsOpen,
          exitDockRestoringAttributes: vi.fn(),
          focusUpdateSettings: vi.fn(),
          updates: { enabled: true, updateInfo: { hasUpdate: false } },
          updateBusy,
        }),
      { initialProps: { updateBusy: false } }
    );
    const pending = result.current.onOpenSettings();
    rerender({ updateBusy: true });
    await act(async () => {
      finishShow();
      await pending;
    });
    expect(setSettingsOpen).not.toHaveBeenCalled();
  });

  it.each([
    [{}, "Check for Updates…", true],
    [{ checkStatus: "checking" }, "Checking for Updates…", false],
    [{ checkStatus: "unavailable" }, "Retry Update Check…", true],
    [
      { updateInfo: { hasUpdate: true, latestVersion: "1.2.3" } },
      "Update Available: v1.2.3…",
      true,
    ],
    [{ downloading: true }, "Downloading Update…", true],
    [{ ready: { version: "1.2.3" }, checkStatus: "unavailable" }, "Update Ready: v1.2.3…", true],
    [
      { ready: { version: "1.2.3" }, updateInfo: { hasUpdate: true }, checkStatus: "checking" },
      "Update Ready: v1.2.3…",
      true,
    ],
  ])("presents update state %j", (state, text, enabled) => {
    const { result } = setup({}, state);
    expect(result.current.updateMenu).toMatchObject({ text, enabled });
  });

  it("omits updates when the running identity does not offer them", () => {
    const { result } = setup({}, { enabled: false });
    expect(result.current.updateMenu).toBeNull();
  });
});
