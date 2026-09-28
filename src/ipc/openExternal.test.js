/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("./env.js", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));

import { openExternalUrl, PRIVACY_POLICY_URL } from "./openExternal.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("openExternalUrl", () => {
  it("uses the desktop opener inside Tauri", async () => {
    mocks.isTauri.mockReturnValue(true);

    await openExternalUrl(PRIVACY_POLICY_URL);

    expect(mocks.openUrl).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
  });

  it("uses a browser tab outside the desktop shell", async () => {
    mocks.isTauri.mockReturnValue(false);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternalUrl(PRIVACY_POLICY_URL);

    expect(open).toHaveBeenCalledWith(PRIVACY_POLICY_URL, "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("ignores an empty URL", async () => {
    await openExternalUrl("");

    expect(mocks.openUrl).not.toHaveBeenCalled();
  });
});
