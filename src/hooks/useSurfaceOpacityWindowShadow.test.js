/** @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => {}),
  isTauri: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../ipc/env.js", () => ({ isTauri: mocks.isTauri }));

import {
  syncSurfaceOpacityWindowShadow,
  useSurfaceOpacityWindowShadow,
} from "./useSurfaceOpacityWindowShadow.js";

describe("surface opacity native window shadow", () => {
  beforeEach(() => {
    mocks.invoke.mockClear();
    mocks.isTauri.mockReturnValue(true);
  });

  it("sends the opacity to the Rust-owned platform policy", async () => {
    await expect(syncSurfaceOpacityWindowShadow(0)).resolves.toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("sync_surface_opacity_shadow", {
      surfaceOpacity: 0,
    });
  });

  it("does nothing outside the desktop shell", async () => {
    mocks.isTauri.mockReturnValue(false);
    await expect(syncSurfaceOpacityWindowShadow(0)).resolves.toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("updates native state only when opacity crosses the zero boundary", async () => {
    const { rerender } = renderHook(({ opacity }) => useSurfaceOpacityWindowShadow(opacity), {
      initialProps: { opacity: 80 },
    });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.invoke).toHaveBeenLastCalledWith("sync_surface_opacity_shadow", {
      surfaceOpacity: 100,
    });

    rerender({ opacity: 40 });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    rerender({ opacity: 0 });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.invoke).toHaveBeenLastCalledWith("sync_surface_opacity_shadow", {
      surfaceOpacity: 0,
    });
  });
});
