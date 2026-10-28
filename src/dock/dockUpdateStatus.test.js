import { describe, expect, it } from "vitest";
import { dockUpdateStatus } from "./dockUpdateStatus.js";

const base = { updateInfo: { hasUpdate: true, latestVersion: "0.22.0" } };

describe("dockUpdateStatus", () => {
  it("offers an update-check retry even when no candidate was found", () => {
    expect(
      dockUpdateStatus({ updateInfo: { status: "unavailable", hasUpdate: false } })
    ).toMatchObject({ phase: "error", text: "Update Check Failed", action: "check-update" });
    expect(
      dockUpdateStatus({
        ...base,
        updateInfo: { ...base.updateInfo, activity: { downloadError: "Download interrupted" } },
      })
    ).toMatchObject({ phase: "error", text: "Update Failed" });
  });
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
