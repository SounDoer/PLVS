import { afterEach, describe, expect, it, vi } from "vitest";

const checkMock = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args) => checkMock(...args),
}));

const { checkForUpdate, RELEASES_URL } = await import("./updateCheck.js");

afterEach(() => {
  vi.clearAllMocks();
});

describe("checkForUpdate", () => {
  it("returns release notes and the raw update handle when a newer version exists", async () => {
    const fakeUpdate = {
      version: "0.1.10",
      body: "### Fixed\n- Safer update flow.",
      downloadAndInstall: vi.fn(),
    };
    checkMock.mockResolvedValue(fakeUpdate);

    await expect(checkForUpdate()).resolves.toEqual({
      hasUpdate: true,
      latestVersion: "0.1.10",
      releaseNotes: "### Fixed\n- Safer update flow.",
      releaseUrl: RELEASES_URL,
      update: fakeUpdate,
    });
  });

  it("returns hasUpdate: false when already up to date", async () => {
    checkMock.mockResolvedValue(null);

    await expect(checkForUpdate()).resolves.toEqual({
      hasUpdate: false,
      latestVersion: null,
      releaseUrl: RELEASES_URL,
      update: null,
    });
  });

  it("returns null when the check throws", async () => {
    checkMock.mockRejectedValue(new Error("network down"));

    await expect(checkForUpdate()).resolves.toBeNull();
  });
});
