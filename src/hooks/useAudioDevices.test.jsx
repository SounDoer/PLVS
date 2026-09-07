/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAudioDevices: vi.fn(),
  migrateCaptureDeviceId: vi.fn(),
  previewAudioDevice: vi.fn(),
  loadCaptureDeviceId: vi.fn(),
  readCaptureDeviceIdFromLocalStorage: vi.fn(),
  saveCaptureDeviceId: vi.fn(),
  onDeviceListChanged: vi.fn(),
  deviceListHandler: null,
  unlisten: vi.fn(),
}));

vi.mock("../ipc/commands.js", () => ({
  listAudioDevices: mocks.listAudioDevices,
  migrateCaptureDeviceId: mocks.migrateCaptureDeviceId,
  previewAudioDevice: mocks.previewAudioDevice,
}));
vi.mock("../ipc/capturePrefs.js", () => ({
  loadCaptureDeviceId: mocks.loadCaptureDeviceId,
  readCaptureDeviceIdFromLocalStorage: mocks.readCaptureDeviceIdFromLocalStorage,
  saveCaptureDeviceId: mocks.saveCaptureDeviceId,
}));
vi.mock("../ipc/events.js", () => ({
  onDeviceListChanged: mocks.onDeviceListChanged,
}));
vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));

import { useAudioDevices } from "./useAudioDevices.js";

const LB = "lb-0123456789abcdef0123456789abcdef";
const CAP = "cap-fedcba9876543210fedcba9876543210";

function device(id, label, output = false) {
  return {
    id,
    label,
    isSystemOutputMonitor: output,
    isLoopback: output,
    defaultSampleRate: 48_000,
    channels: 2,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deviceListHandler = null;
  mocks.readCaptureDeviceIdFromLocalStorage.mockReturnValue("default");
  mocks.loadCaptureDeviceId.mockResolvedValue("default");
  mocks.listAudioDevices.mockResolvedValue([device(LB, "Speakers", true), device(CAP, "Mic")]);
  mocks.previewAudioDevice.mockResolvedValue({
    label: "Speakers",
    sampleRateHz: 48_000,
    channels: 2,
  });
  mocks.saveCaptureDeviceId.mockResolvedValue(undefined);
  mocks.migrateCaptureDeviceId.mockResolvedValue(null);
  mocks.onDeviceListChanged.mockImplementation(async (handler) => {
    mocks.deviceListHandler = handler;
    return mocks.unlisten;
  });
});

describe("useAudioDevices", () => {
  it("publishes one coherent inventory snapshot and awaits selection persistence", async () => {
    const save = deferred();
    mocks.saveCaptureDeviceId.mockReturnValueOnce(save.promise);
    const { result } = renderHook(() => useAudioDevices());
    await waitFor(() => expect(result.current.snapshot.inventoryReady).toBe(true));
    expect(result.current.snapshot).toMatchObject({
      generation: 1,
      requestedId: "default",
      automatic: { available: true, resolved: { label: "Speakers" } },
    });
    expect(result.current.audioDevices.map(({ id }) => id)).toEqual([LB, CAP]);

    let settled = false;
    let selection;
    act(() => {
      selection = result.current.selectCaptureDevice(CAP).then(() => (settled = true));
    });
    await waitFor(() => expect(result.current.captureDeviceId).toBe(CAP));
    expect(settled).toBe(false);
    await act(async () => save.resolve());
    await selection;
    expect(settled).toBe(true);
    expect(mocks.saveCaptureDeviceId).toHaveBeenCalledWith(CAP);
  });

  it("keeps the visible committed selection and reports persistence failure", async () => {
    mocks.saveCaptureDeviceId.mockRejectedValueOnce(new Error("disk full"));
    const { result } = renderHook(() => useAudioDevices());
    await waitFor(() => expect(result.current.snapshot.inventoryReady).toBe(true));
    let selection;
    act(() => {
      selection = result.current.selectCaptureDevice(CAP);
    });
    await act(async () => {
      await expect(selection).rejects.toMatchObject({ message: "disk full", stateCommitted: true });
    });
    expect(result.current.captureDeviceId).toBe(CAP);
  });

  it("preflights and awaits the normal Live restart around a running selection", async () => {
    const restart = deferred();
    const beginDeviceRestartForControl = vi.fn(() => restart.promise);
    const { result } = renderHook(() =>
      useAudioDevices({ liveLifecycle: "running", beginDeviceRestartForControl })
    );
    await waitFor(() => expect(result.current.snapshot.inventoryReady).toBe(true));
    let settled = false;
    let selection;
    act(() => {
      selection = result.current.selectCaptureDevice(CAP).then(() => (settled = true));
    });
    await waitFor(() => expect(beginDeviceRestartForControl).toHaveBeenCalledOnce());
    expect(mocks.previewAudioDevice).toHaveBeenCalledWith(CAP);
    expect(mocks.saveCaptureDeviceId).toHaveBeenCalledWith(CAP);
    expect(settled).toBe(false);
    await act(async () => restart.resolve());
    await selection;
    expect(settled).toBe(true);
  });

  it("leaves the current Live session untouched when preflight fails", async () => {
    const beginDeviceRestartForControl = vi.fn();
    const { result } = renderHook(() =>
      useAudioDevices({ liveLifecycle: "running", beginDeviceRestartForControl })
    );
    await waitFor(() => expect(result.current.snapshot.inventoryReady).toBe(true));
    mocks.previewAudioDevice.mockRejectedValueOnce(new Error("device vanished"));
    await expect(result.current.selectCaptureDevice(CAP)).rejects.toMatchObject({
      code: "deviceUnavailable",
    });
    expect(beginDeviceRestartForControl).not.toHaveBeenCalled();
    expect(mocks.saveCaptureDeviceId).not.toHaveBeenCalled();
    expect(result.current.captureDeviceId).toBe("default");
  });

  it("keeps a committed selection when the normal Live restart fails", async () => {
    const restart = deferred();
    const { result } = renderHook(() =>
      useAudioDevices({
        liveLifecycle: "running",
        beginDeviceRestartForControl: () => restart.promise,
      })
    );
    await waitFor(() => expect(result.current.snapshot.inventoryReady).toBe(true));
    const selection = result.current.selectCaptureDevice(CAP);
    const failedSelection = expect(selection).rejects.toThrow("device busy");
    await waitFor(() => expect(result.current.captureDeviceId).toBe(CAP));
    await act(async () => restart.reject(new Error("device busy")));
    await act(async () => {
      await failedSelection;
    });
    expect(result.current.captureDeviceId).toBe(CAP);
    expect(mocks.saveCaptureDeviceId).toHaveBeenCalledWith(CAP);
  });

  it("advances generation for hotplug without changing the requested selection", async () => {
    const { result } = renderHook(() => useAudioDevices());
    await waitFor(() => expect(result.current.snapshot.generation).toBe(1));
    await act(async () => mocks.deviceListHandler([device(LB, "Renamed Speakers", true)]));
    await waitFor(() => expect(result.current.snapshot.generation).toBe(2));
    expect(result.current.captureDeviceId).toBe("default");
    expect(result.current.audioDevices.map(({ label }) => label)).toEqual(["Renamed Speakers"]);
  });

  it("drops a stale Automatic preview instead of overwriting a newer inventory", async () => {
    const firstPreview = deferred();
    const secondPreview = deferred();
    mocks.previewAudioDevice
      .mockReturnValueOnce(firstPreview.promise)
      .mockReturnValueOnce(secondPreview.promise);
    const { result } = renderHook(() => useAudioDevices());
    await waitFor(() => expect(mocks.deviceListHandler).toBeTypeOf("function"));
    act(() => mocks.deviceListHandler([device(CAP, "New Mic")]));
    await act(async () =>
      secondPreview.resolve({ label: "New Default", sampleRateHz: 96_000, channels: 2 })
    );
    await waitFor(() =>
      expect(result.current.snapshot.automatic.resolved?.label).toBe("New Default")
    );
    await act(async () =>
      firstPreview.resolve({ label: "Old Default", sampleRateHz: 44_100, channels: 2 })
    );
    expect(result.current.snapshot.automatic.resolved?.label).toBe("New Default");
    expect(result.current.audioDevices[0].id).toBe(CAP);
  });

  it("migrates an unavailable legacy ID through the same awaited owner", async () => {
    mocks.readCaptureDeviceIdFromLocalStorage.mockReturnValue("out:2");
    mocks.loadCaptureDeviceId.mockResolvedValue("out:2");
    mocks.migrateCaptureDeviceId.mockResolvedValue(CAP);
    const { result } = renderHook(() => useAudioDevices());
    await waitFor(() => expect(result.current.captureDeviceId).toBe(CAP));
    expect(mocks.migrateCaptureDeviceId).toHaveBeenCalledWith("out:2");
    expect(mocks.saveCaptureDeviceId).toHaveBeenCalledWith(CAP);
    expect(result.current.snapshot.migrationState).toBeNull();
  });

  it("cancels pending inventory and migration work on unmount", async () => {
    const preview = deferred();
    mocks.previewAudioDevice.mockReturnValue(preview.promise);
    const { unmount } = renderHook(() => useAudioDevices());
    await waitFor(() => expect(mocks.onDeviceListChanged).toHaveBeenCalled());
    unmount();
    await act(async () => preview.resolve({ label: "Late", sampleRateHz: 48_000, channels: 2 }));
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });
});
