/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  openPath: vi.fn(),
  openUrl: vi.fn(),
  resolveResource: vi.fn(),
}));

vi.mock("./env.js", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/path", () => ({ resolveResource: mocks.resolveResource }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: mocks.openPath,
  openUrl: mocks.openUrl,
}));

import { LICENSE_NOTICES_URL, openLicenseNotices } from "./openExternal.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("openLicenseNotices", () => {
  it("opens the installed notice from Tauri resources", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.resolveResource.mockResolvedValue(
      "C:\\Program Files\\PLVS\\licenses\\THIRD-PARTY-NOTICES.txt"
    );

    await openLicenseNotices();

    expect(mocks.resolveResource).toHaveBeenCalledWith("licenses/THIRD-PARTY-NOTICES.txt");
    expect(mocks.openPath).toHaveBeenCalledWith(
      "C:\\Program Files\\PLVS\\licenses\\THIRD-PARTY-NOTICES.txt"
    );
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("uses the public notice when rendered outside the desktop shell", async () => {
    mocks.isTauri.mockReturnValue(false);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    await openLicenseNotices();

    expect(open).toHaveBeenCalledWith(LICENSE_NOTICES_URL, "_blank", "noopener,noreferrer");
    expect(mocks.resolveResource).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
