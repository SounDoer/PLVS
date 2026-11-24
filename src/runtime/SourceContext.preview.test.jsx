/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SourceProvider, useSource } from "./SourceContext.jsx";

const data = vi.hoisted(() => ({
  draft: null,
  list: [],
  requestedId: "default",
  select: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../lib/platform.js", () => ({ isWindows: () => true }));
vi.mock("../persistence/index.js", () => ({ usesTransactionalPersistence: true }));
vi.mock("../hooks/useSourceMixes.js", () => ({
  useSourceMixes: () => ({ supported: true, draft: data.draft, list: data.list }),
}));
vi.mock("../hooks/useAudioDevices.js", () => ({
  useAudioDevices: () => ({
    audioDevices: [],
    captureApplications: [],
    captureDeviceId: data.requestedId,
    selectCaptureDevice: data.select,
    defaultOutputFormatSig: "2:48000",
    defaultOutputLabel: "Speakers",
    refreshCaptureApplications: data.refresh,
    snapshot: { inventoryReady: true },
  }),
}));
vi.mock("./MeterRuntimeContext.jsx", () => ({
  useMeterRuntime: () => ({ sourceMode: "live", running: true, liveLifecycle: "running" }),
  useMeterDisplayState: () => ({ clearNotice: vi.fn(), raiseNotice: vi.fn() }),
}));

const sourceId = `app-${"a".repeat(32)}`;
const previewId = "mix-00000000-0000-0000-0000-000000000001";
const newMix = { id: null, previewId, name: "", members: [{ id: sourceId, label: "Player" }] };
const wrapper = ({ children }) => <SourceProvider>{children}</SourceProvider>;

beforeEach(() => {
  data.draft = null;
  data.list = [];
  data.requestedId = "default";
  data.select.mockClear();
});

it("previews an unsaved Mix, holds its last valid routing, and restores the original source", () => {
  const { result, rerender } = renderHook(() => useSource(), { wrapper });
  expect(result.current.captureRuntimeDeviceId).toBe("default");
  data.draft = { ...newMix, format: "5.1", routes: { [sourceId]: { L: "Ls" } } };
  rerender();
  const { captureFormatSignature, mixRouting } = result.current;
  expect(result.current.captureDeviceId).toBe("default");
  expect(result.current.captureRuntimeDeviceId).toBe(previewId);
  expect(result.current.mixPreviewActive).toBe(true);
  expect(mixRouting.routes[sourceId][0]).toEqual([[4, 1]]);

  data.draft = { ...data.draft, format: "stereo" };
  rerender();
  expect(result.current.captureFormatSignature).toBe(captureFormatSignature);
  expect(result.current.mixRouting).toBe(mixRouting);

  data.draft = null;
  rerender();
  expect(result.current.captureRuntimeDeviceId).toBe("default");
  expect(result.current.mixPreviewActive).toBe(false);
  expect(data.select).not.toHaveBeenCalled();
});

it("keeps the active Mix capture unchanged when its preview is saved", () => {
  const saved = { ...newMix, id: previewId, format: "stereo" };
  data.requestedId = previewId;
  data.list = [saved];
  data.draft = { ...saved, original: saved };
  const { result, rerender } = renderHook(() => useSource(), { wrapper });
  expect(result.current.mixPreviewActive).toBe(false);
  data.draft = { ...data.draft, format: "5.1" };
  rerender();
  const { captureFormatSignature, mixRouting } = result.current;
  expect(result.current.mixPreviewActive).toBe(true);

  data.list = [{ ...saved, format: "5.1" }];
  data.draft = null;
  rerender();
  expect(result.current.mixPreviewActive).toBe(false);
  expect(result.current.captureFormatSignature).toBe(captureFormatSignature);
  expect(result.current.mixRouting).toBe(mixRouting);
});
