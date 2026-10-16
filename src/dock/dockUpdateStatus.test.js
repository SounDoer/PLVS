import { describe, expect, it } from "vitest";
import { dockUpdateStatus } from "./dockUpdateStatus.js";

const base = { updateInfo: { hasUpdate: true, latestVersion: "0.22.0" } };

describe("dockUpdateStatus", () => {
  it("is absent without an update", () => {
    expect(dockUpdateStatus({ updateInfo: { hasUpdate: false } })).toBeNull();
  });
  it("names each phase, with failure first and progress only while downloading", () => {
    expect(dockUpdateStatus(base)).toEqual({
      phase: "available",
      label: "Update Available",
      text: "Update Available · v0.22.0",
    });
    expect(dockUpdateStatus({ ...base, downloading: true, downloadProgress: 0.454 }).text).toBe(
      "Downloading Update · 45%"
    );
    expect(dockUpdateStatus({ ...base, downloading: true, downloadProgress: null }).text).toBe(
      "Downloading Update"
    );
    expect(dockUpdateStatus({ ...base, ready: { id: "a" } }).text).toBe("Update Ready · v0.22.0");
    expect(dockUpdateStatus({ ...base, ready: { id: "a" }, error: "failed" })).toMatchObject({
      phase: "error",
      text: "Update Failed",
    });
  });
});
