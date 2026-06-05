import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, compareVersions } from "./updateCheck.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("compareVersions", () => {
  it("compares semantic version segments numerically", () => {
    expect(compareVersions("0.1.10", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.9", "0.1.10")).toBeLessThan(0);
    expect(compareVersions("v0.1.3", "0.1.3")).toBe(0);
  });
});

describe("checkForUpdate", () => {
  it("returns semantic update status from the latest GitHub release", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: "v0.1.10",
        html_url: "https://github.com/SounDoer/PLVS/releases/tag/v0.1.10",
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(checkForUpdate("0.1.9")).resolves.toEqual({
      latestVersion: "0.1.10",
      releaseUrl: "https://github.com/SounDoer/PLVS/releases/tag/v0.1.10",
      hasUpdate: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/SounDoer/PLVS/releases/latest",
      {
        headers: { Accept: "application/vnd.github+json" },
      }
    );
  });
});
