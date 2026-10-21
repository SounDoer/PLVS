import { describe, expect, it } from "vitest";
import { offlineRigPlatforms } from "./release-dispatch.mjs";

const runner = (status, ...labels) => ({
  status,
  labels: ["self-hosted", ...labels].map((name) => ({ name })),
});

describe("offlineRigPlatforms", () => {
  it("accepts one online rig runner per platform, matching labels case-insensitively", () => {
    expect(
      offlineRigPlatforms([
        runner("online", "plvs-rig", "Windows"),
        runner("online", "macOS", "plvs-rig"),
        runner("online", "plvs-rig", "Linux"),
      ])
    ).toEqual([]);
  });

  it("names platforms whose runner is offline or not a rig runner", () => {
    expect(
      offlineRigPlatforms([
        runner("online", "plvs-rig", "Windows"),
        runner("offline", "plvs-rig", "macOS"),
        runner("online", "Linux"),
      ])
    ).toEqual(["macos", "linux"]);
  });
});
