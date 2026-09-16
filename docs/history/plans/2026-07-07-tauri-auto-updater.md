# Tauri Auto-Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "click through to GitHub Releases and manually install" update flow with an in-app "Update" button that downloads, signature-verifies, installs, and (on confirmation) restarts the app — using `tauri-plugin-updater` against a signed `latest.json` published to GitHub Releases.

**Architecture:** Rust registers `tauri-plugin-updater`; `src/lib/updateCheck.js` calls the plugin's `check()` instead of the GitHub Releases API (single source of truth for "is there an update", shared with the actual install path); a new `useApplyUpdate` hook drives download/install/restart; `SettingsPanel` gets a new "Update"/"Restart" button next to the existing "Check". CI signs release artifacts and assembles `latest.json` from per-platform `.sig` files produced by `tauri build`.

**Tech Stack:** Tauri v2 (`tauri-plugin-updater`, `tauri-plugin-process` — already present), React 19, Vitest, GitHub Actions.

---

## Reference: design spec

Full rationale in [`docs/superpowers/specs/2026-07-07-tauri-auto-updater-design.md`](../specs/2026-07-07-tauri-auto-updater-design.md). This plan implements that spec; don't re-derive decisions already made there.

---

### Task 1: Rust — register the updater plugin

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs:30-39`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/capabilities/default.test.js`

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml`, in the `[dependencies]` block (alongside the other `tauri-plugin-*` entries), add:

```toml
tauri-plugin-updater = "2"
```

- [ ] **Step 2: Register the plugin**

In `src-tauri/src/lib.rs`, add the plugin to the builder chain (order doesn't matter relative to the others, but put it next to the other `tauri-plugin-*` registrations for readability):

```rust
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_autostart::init(
```

- [ ] **Step 3: Add the capability permission**

In `src-tauri/capabilities/default.json`, add `"updater:default"` to the `permissions` array (next to `"store:default"` is fine):

```json
    "store:default",
    "updater:default",
```

- [ ] **Step 4: Add a capability test**

In `src-tauri/capabilities/default.test.js`, add a new `it` block following the existing pattern:

```js
  it("allows the updater plugin to check and install updates", () => {
    expect(capability.permissions).toContain("updater:default");
  });
```

- [ ] **Step 5: Verify the Rust side builds**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles clean (may take a minute to fetch the new crate).

- [ ] **Step 6: Run the capability test**

Run: `npx vitest run src-tauri/capabilities/default.test.js`
Expected: PASS (2 tests, including the new one).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json src-tauri/capabilities/default.test.js
git commit -m "feat(updater): register tauri-plugin-updater"
```

---

### Task 2: Generate the update-signing keypair

This key signs update artifacts so the updater plugin can verify they weren't tampered with. The private key must never be committed or pasted into chat/logs — only the public key is checked in.

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Generate the keypair to a local, git-ignored path**

Run (from repo root; adjust the path if `%TEMP%` differs — anywhere outside the repo working tree is fine):

```bash
npx --yes @tauri-apps/cli signer generate -w "$TEMP/plvs-updater.key" --password ""
```

This prints the **public key** to stdout and writes the **private key** to `$TEMP/plvs-updater.key` (plus a `.pub` sibling with the same public key). An empty password is acceptable here because the private key never leaves the local machine / GitHub Secrets — but if you'd rather set one, pass `--password "<something>"` and remember to also set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to match in Step 3.

- [ ] **Step 2: Paste the public key into `tauri.conf.json`**

In `src-tauri/tauri.conf.json`, add a `plugins` block (it doesn't exist yet — add it as a top-level sibling of `"app"` and `"bundle"`):

```json
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/SounDoer/PLVS/releases/latest/download/latest.json"
      ],
      "pubkey": "<paste the public key printed in Step 1 here>"
    }
  }
```

- [ ] **Step 3: Store the private key as GitHub repo secrets (manual, user)**

In the GitHub repo settings → Secrets and variables → Actions, add:
- `TAURI_SIGNING_PRIVATE_KEY` — the full contents of `$TEMP/plvs-updater.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password used in Step 1 (empty string if none)

Then delete the local key file once it's safely in GitHub Secrets:

```bash
rm "$TEMP/plvs-updater.key" "$TEMP/plvs-updater.key.pub"
```

- [ ] **Step 4: Commit the config change**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat(updater): configure updater plugin endpoint and public key"
```

---

### Task 3: Rewrite `updateCheck.js` to use the updater plugin

**Files:**
- Modify: `src/lib/updateCheck.js`
- Modify: `src/lib/updateCheck.test.js`

- [ ] **Step 1: Write the failing test**

Replace the full contents of `src/lib/updateCheck.test.js`:

```js
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
  it("returns hasUpdate + the raw update handle when a newer version exists", async () => {
    const fakeUpdate = { version: "0.1.10", downloadAndInstall: vi.fn() };
    checkMock.mockResolvedValue(fakeUpdate);

    await expect(checkForUpdate()).resolves.toEqual({
      hasUpdate: true,
      latestVersion: "0.1.10",
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/updateCheck.test.js`
Expected: FAIL — `checkForUpdate` still uses the old GitHub API shape / `@tauri-apps/plugin-updater` isn't installed yet.

- [ ] **Step 3: Install the plugin's JS package**

Run: `npm install @tauri-apps/plugin-updater`

This adds it to `package.json` `dependencies` alongside the other `@tauri-apps/plugin-*` entries.

- [ ] **Step 4: Replace `src/lib/updateCheck.js`**

Replace the full contents:

```js
/**
 * Update check backed by tauri-plugin-updater, comparing against the signed
 * latest.json manifest published with each GitHub Release.
 */
import { check } from "@tauri-apps/plugin-updater";

export const RELEASES_URL = "https://github.com/SounDoer/PLVS/releases/latest";

/**
 * Check for an update.
 * Returns { hasUpdate, latestVersion, releaseUrl, update } where `update` is
 * the raw plugin handle (needed to actually install it), or null on failure.
 */
export async function checkForUpdate() {
  try {
    const update = await check();
    if (!update) {
      return { hasUpdate: false, latestVersion: null, releaseUrl: RELEASES_URL, update: null };
    }
    return {
      hasUpdate: true,
      latestVersion: update.version,
      releaseUrl: RELEASES_URL,
      update,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/updateCheck.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/updateCheck.js src/lib/updateCheck.test.js
git commit -m "feat(updater): check via tauri-plugin-updater instead of the GitHub API"
```

---

### Task 4: Update `useUpdateCheck` for the new shape and add `useApplyUpdate`

**Files:**
- Modify: `src/hooks/useUpdateCheck.js`
- Modify: `src/hooks/useUpdateCheck.test.js`
- Create: `src/hooks/useApplyUpdate.js`
- Create: `src/hooks/useApplyUpdate.test.js`

- [ ] **Step 1: Write the failing test for `useUpdateCheck`**

Replace the full contents of `src/hooks/useUpdateCheck.test.js`:

```js
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("../lib/updateCheck.js", () => ({
  checkForUpdate: vi.fn(),
}));

import { checkForUpdate } from "../lib/updateCheck.js";
import { UPDATE_CHECK_INTERVAL_MS, useUpdateCheck } from "./useUpdateCheck.js";

describe("useUpdateCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks for updates on mount", async () => {
    checkForUpdate.mockResolvedValue({
      latestVersion: "0.2.4",
      releaseUrl: "https://github.com/SounDoer/PLVS/releases/latest",
      hasUpdate: true,
      update: { version: "0.2.4" },
    });

    const { result } = renderHook(() => useUpdateCheck());

    expect(result.current.isCheckingForUpdate).toBe(true);
    await waitFor(() => expect(result.current.updateInfo.status).toBe("ok"));
    expect(checkForUpdate).toHaveBeenCalledWith();
    expect(result.current.updateInfo.hasUpdate).toBe(true);
    expect(result.current.updateInfo.update).toEqual({ version: "0.2.4" });
  });

  it("exposes a manual refresh that returns to checking while the request is pending", async () => {
    checkForUpdate.mockResolvedValueOnce({
      latestVersion: null,
      releaseUrl: "https://github.com/SounDoer/PLVS/releases/latest",
      hasUpdate: false,
      update: null,
    });

    const { result } = renderHook(() => useUpdateCheck(0));
    await waitFor(() => expect(result.current.updateInfo.status).toBe("ok"));

    let resolveRefresh;
    checkForUpdate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        })
    );

    act(() => {
      result.current.refreshUpdateCheck();
    });

    expect(result.current.isCheckingForUpdate).toBe(true);

    await act(async () => {
      resolveRefresh({
        latestVersion: "0.2.4",
        releaseUrl: "https://github.com/SounDoer/PLVS/releases/latest",
        hasUpdate: true,
        update: { version: "0.2.4" },
      });
    });

    await waitFor(() => expect(result.current.updateInfo.latestVersion).toBe("0.2.4"));
  });

  it("checks again on the 12 hour interval", async () => {
    vi.useFakeTimers();
    checkForUpdate.mockResolvedValue({
      latestVersion: null,
      releaseUrl: "https://github.com/SounDoer/PLVS/releases/latest",
      hasUpdate: false,
      update: null,
    });

    renderHook(() => useUpdateCheck());
    await act(async () => {});
    expect(checkForUpdate).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    });

    expect(checkForUpdate).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useUpdateCheck.test.js`
Expected: FAIL — current hook signature still takes `currentVersion` as its first arg, so `useUpdateCheck(0)` in the second test is misread as `currentVersion=0`.

- [ ] **Step 3: Update `src/hooks/useUpdateCheck.js`**

Drop the now-unused `currentVersion` param (the plugin compares against the running app's own version internally, not a value we pass in):

```js
import { useCallback, useEffect, useRef, useState } from "react";
import { checkForUpdate } from "@/lib/updateCheck.js";

export const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

export function useUpdateCheck(intervalMs = UPDATE_CHECK_INTERVAL_MS) {
  const [updateInfo, setUpdateInfo] = useState({ status: "checking" });
  const mountedRef = useRef(false);
  const inFlightRef = useRef(false);

  const refreshUpdateCheck = useCallback(async () => {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setUpdateInfo((current) => ({ ...current, status: "checking" }));

    try {
      const info = await checkForUpdate();
      if (mountedRef.current) {
        setUpdateInfo(info ? { ...info, status: "ok" } : { status: "unavailable" });
      }
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refreshUpdateCheck();

    if (!intervalMs) {
      return () => {
        mountedRef.current = false;
      };
    }

    const intervalId = window.setInterval(refreshUpdateCheck, intervalMs);
    return () => {
      mountedRef.current = false;
      window.clearInterval(intervalId);
    };
  }, [intervalMs, refreshUpdateCheck]);

  return {
    updateInfo,
    isCheckingForUpdate: updateInfo.status === "checking",
    refreshUpdateCheck,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useUpdateCheck.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for the new `useApplyUpdate` hook**

Create `src/hooks/useApplyUpdate.test.js`:

```js
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const relaunchMock = vi.fn();
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args) => relaunchMock(...args),
}));

import { useApplyUpdate } from "./useApplyUpdate.js";

describe("useApplyUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts idle", () => {
    const { result } = renderHook(() => useApplyUpdate());
    expect(result.current.installStatus).toBe("idle");
  });

  it("moves to installing then ready on a successful download+install", async () => {
    let resolveInstall;
    const update = {
      downloadAndInstall: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveInstall = resolve;
          })
      ),
    };
    const { result } = renderHook(() => useApplyUpdate());

    act(() => {
      result.current.install(update);
    });
    expect(result.current.installStatus).toBe("installing");

    await act(async () => {
      resolveInstall();
    });
    await waitFor(() => expect(result.current.installStatus).toBe("ready"));
  });

  it("moves to error when downloadAndInstall rejects", async () => {
    const update = { downloadAndInstall: vi.fn().mockRejectedValue(new Error("boom")) };
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(update);
    });

    expect(result.current.installStatus).toBe("error");
  });

  it("does nothing when install is called with no update handle", async () => {
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(null);
    });

    expect(result.current.installStatus).toBe("idle");
  });

  it("relaunches the app on restartToApply", () => {
    const { result } = renderHook(() => useApplyUpdate());

    act(() => {
      result.current.restartToApply();
    });

    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/hooks/useApplyUpdate.test.js`
Expected: FAIL — `./useApplyUpdate.js` doesn't exist yet.

- [ ] **Step 7: Create `src/hooks/useApplyUpdate.js`**

```js
import { useCallback, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * Drives the download + install step for an Update handle returned by
 * checkForUpdate(), separate from the periodic check itself.
 */
export function useApplyUpdate() {
  const [installStatus, setInstallStatus] = useState("idle");

  const install = useCallback(async (update) => {
    if (!update) return;
    setInstallStatus("installing");
    try {
      await update.downloadAndInstall();
      setInstallStatus("ready");
    } catch {
      setInstallStatus("error");
    }
  }, []);

  const restartToApply = useCallback(() => {
    relaunch();
  }, []);

  return { installStatus, install, restartToApply };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/hooks/useApplyUpdate.test.js`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useUpdateCheck.js src/hooks/useUpdateCheck.test.js src/hooks/useApplyUpdate.js src/hooks/useApplyUpdate.test.js
git commit -m "feat(updater): add useApplyUpdate hook, drop unused currentVersion param"
```

---

### Task 5: Wire `App.jsx` and add the Update/Restart button in `SettingsPanel`

**Files:**
- Modify: `src/App.jsx:103,478,1744-1749`
- Modify: `src/components/SettingsPanel.jsx:110-171,581-592`
- Modify: `src/components/SettingsPanel.test.jsx`

- [ ] **Step 1: Write the failing tests for `SettingsPanel`**

Add these `it` blocks to `src/components/SettingsPanel.test.jsx`, near the other update-related tests (after the "opens the release URL through the provided handler" test):

```js
  it("shows an Update button when hasUpdate is true and calls onInstallUpdate", () => {
    const onInstallUpdate = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appVersion="0.1.9"
        latestVersion="0.1.10"
        hasUpdate={true}
        installStatus="idle"
        onInstallUpdate={onInstallUpdate}
      />
    );

    const updateButton = screen.getByText("Update");
    fireEvent.click(updateButton);
    expect(onInstallUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not show an Update button when there is no update", () => {
    render(<SettingsPanel {...BASE_PROPS} appVersion="0.1.10" latestVersion="0.1.10" hasUpdate={false} />);

    expect(screen.queryByText("Update")).toBeNull();
  });

  it("disables the Update button and shows progress while installing", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appVersion="0.1.9"
        latestVersion="0.1.10"
        hasUpdate={true}
        installStatus="installing"
      />
    );

    expect(screen.getByText("Installing…").closest("button")).toBeDisabled();
  });

  it("shows a Restart button once the update is ready and calls onRestartToApply", () => {
    const onRestartToApply = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appVersion="0.1.9"
        latestVersion="0.1.10"
        hasUpdate={true}
        installStatus="ready"
        onRestartToApply={onRestartToApply}
      />
    );

    fireEvent.click(screen.getByText("Restart"));
    expect(onRestartToApply).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Update")).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/SettingsPanel.test.jsx`
Expected: FAIL — no "Update"/"Restart" button exists yet.

- [ ] **Step 3: Add the new props to `SettingsPanel`**

In `src/components/SettingsPanel.jsx`, extend the props destructuring (around line 122-124):

```js
  hasUpdate = false,
  updateStatus = latestVersion ? "ok" : "checking",
  onCheckForUpdate = () => {},
  installStatus = "idle",
  onInstallUpdate = () => {},
  onRestartToApply = () => {},
```

- [ ] **Step 4: Update the status text logic**

Around line 166-171, extend `updateStatusText`:

```js
  let updateStatusText = "Checking...";
  if (updateStatus === "unavailable") {
    updateStatusText = "Update unavailable";
  } else if (installStatus === "installing") {
    updateStatusText = "Installing update...";
  } else if (installStatus === "ready") {
    updateStatusText = "Ready to restart";
  } else if (installStatus === "error") {
    updateStatusText = "Update failed";
  } else if (!updateCheckDisabled && latestVersion) {
    updateStatusText = hasUpdate ? `v${latestVersion} available` : "Up to date";
  }
```

- [ ] **Step 5: Add the Update/Restart button next to "Check"**

Around line 572-579 (the existing "Check" button), add the new button right after it:

```jsx
                        <button
                          type="button"
                          className={FOOTER_LINK_CLASS}
                          disabled={updateCheckDisabled}
                          onClick={onCheckForUpdate}
                        >
                          Check
                        </button>
                        {hasUpdate && installStatus !== "ready" ? (
                          <>
                            <span className="shrink-0 text-muted-foreground/30">&middot;</span>
                            <button
                              type="button"
                              className={cn(FOOTER_LINK_CLASS, "text-primary hover:text-primary")}
                              disabled={installStatus === "installing"}
                              onClick={onInstallUpdate}
                            >
                              {installStatus === "installing"
                                ? "Installing…"
                                : installStatus === "error"
                                  ? "Retry Update"
                                  : "Update"}
                            </button>
                          </>
                        ) : null}
                        {installStatus === "ready" ? (
                          <>
                            <span className="shrink-0 text-muted-foreground/30">&middot;</span>
                            <button
                              type="button"
                              className={cn(FOOTER_LINK_CLASS, "text-primary hover:text-primary")}
                              onClick={onRestartToApply}
                            >
                              Restart
                            </button>
                          </>
                        ) : null}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/components/SettingsPanel.test.jsx`
Expected: PASS (all existing + 4 new tests).

- [ ] **Step 7: Wire it up in `App.jsx`**

In `src/App.jsx`, update the `useUpdateCheck` import site (line ~478) and add `useApplyUpdate`:

```js
import { useUpdateCheck } from "./hooks/useUpdateCheck.js";
import { useApplyUpdate } from "./hooks/useApplyUpdate.js";
```

```js
  const { updateInfo, refreshUpdateCheck } = useUpdateCheck();
  const { installStatus, install, restartToApply } = useApplyUpdate();
```

Then in the `<SettingsPanel ... />` props (around line 1744-1749), add:

```jsx
          appVersion={APP_VERSION}
          latestVersion={updateInfo?.latestVersion}
          releaseUrl={updateInfo?.releaseUrl}
          hasUpdate={updateInfo?.hasUpdate}
          updateStatus={updateInfo?.status}
          onCheckForUpdate={refreshUpdateCheck}
          installStatus={installStatus}
          onInstallUpdate={() => install(updateInfo?.update)}
          onRestartToApply={restartToApply}
```

- [ ] **Step 8: Run the full frontend test suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 9: Commit**

```bash
git add src/App.jsx src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx
git commit -m "feat(updater): add in-app Update/Restart button to Settings footer"
```

---

### Task 6: CI — sign release artifacts and publish `latest.json`

**Files:**
- Create: `scripts/build-updater-manifest.mjs`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Write the manifest-assembly script**

Create `scripts/build-updater-manifest.mjs`. It's filename-agnostic: each platform job uploads a small JSON descriptor (`{ platform, url, signature }`) as a workflow artifact after building; this script merges N of those descriptor files into one `latest.json`.

```js
#!/usr/bin/env node
/**
 * Merge per-platform updater descriptor JSON files (each written by a build job:
 * { platform, url, signature }) into one latest.json for tauri-plugin-updater.
 * Usage: node scripts/build-updater-manifest.mjs <version> <notesFile> <outFile> <descriptor1.json> [descriptor2.json ...]
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , version, notesFile, outFile, ...descriptorFiles] = process.argv;

if (!version || !notesFile || !outFile || descriptorFiles.length === 0) {
  console.error(
    "Usage: node scripts/build-updater-manifest.mjs <version> <notesFile> <outFile> <descriptor.json...>"
  );
  process.exit(1);
}

const notes = readFileSync(notesFile, "utf8");
const platforms = {};

for (const file of descriptorFiles) {
  const { platform, url, signature } = JSON.parse(readFileSync(file, "utf8"));
  if (!platform || !url || !signature) {
    throw new Error(`Descriptor ${file} is missing platform/url/signature`);
  }
  platforms[platform] = { signature, url };
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms,
};

writeFileSync(outFile, JSON.stringify(manifest, null, 2), "utf8");
console.log(`Wrote ${outFile} with platforms: ${Object.keys(platforms).join(", ")}`);
```

- [ ] **Step 2: Add a unit test for the script's merge logic**

Create `scripts/build-updater-manifest.test.mjs`:

```js
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("build-updater-manifest", () => {
  it("merges platform descriptors into one manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "updater-manifest-"));
    const notesFile = join(dir, "notes.md");
    const winFile = join(dir, "windows.json");
    const macFile = join(dir, "macos.json");
    const outFile = join(dir, "latest.json");

    writeFileSync(notesFile, "Release notes\n");
    writeFileSync(
      winFile,
      JSON.stringify({
        platform: "windows-x86_64",
        url: "https://github.com/SounDoer/PLVS/releases/download/v0.7.0/PLVS-v0.7.0-x64-setup.nsis.zip",
        signature: "sig-win",
      })
    );
    writeFileSync(
      macFile,
      JSON.stringify({
        platform: "darwin-aarch64",
        url: "https://github.com/SounDoer/PLVS/releases/download/v0.7.0/PLVS-v0.7.0-aarch64.app.tar.gz",
        signature: "sig-mac",
      })
    );

    execFileSync("node", [
      "scripts/build-updater-manifest.mjs",
      "0.7.0",
      notesFile,
      outFile,
      winFile,
      macFile,
    ]);

    const manifest = JSON.parse(readFileSync(outFile, "utf8"));
    expect(manifest.version).toBe("0.7.0");
    expect(manifest.notes).toBe("Release notes\n");
    expect(manifest.platforms["windows-x86_64"]).toEqual({
      signature: "sig-win",
      url: "https://github.com/SounDoer/PLVS/releases/download/v0.7.0/PLVS-v0.7.0-x64-setup.nsis.zip",
    });
    expect(manifest.platforms["darwin-aarch64"].signature).toBe("sig-mac");
    expect(typeof manifest.pub_date).toBe("string");
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run scripts/build-updater-manifest.test.mjs`
Expected: PASS.

- [ ] **Step 4: Add signing env vars and a descriptor-writing step to `build-windows`**

In `.github/workflows/release.yml`, add `env` to the `build-windows` job (so `tauri build` signs its updater artifacts) and a step after "Build Tauri bundle" that locates the `.nsis.zip`/`.sig` pair and writes the descriptor JSON. Modify the job like this:

```yaml
  build-windows:
    needs: [verify, verify-rust]
    runs-on: windows-latest
    env:
      TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
    steps:
```

(keep all existing steps as-is through "Build Tauri bundle (NSIS + release binary for portable)"), then insert a new step right after it and before "Smoke test Windows installer":

```yaml
      - name: Write updater descriptor (tag builds only)
        if: startsWith(github.ref, 'refs/tags/v')
        shell: pwsh
        run: |
          $sig = Get-ChildItem "src-tauri/target/release/bundle/nsis/*.nsis.zip.sig" | Select-Object -First 1
          if (!$sig) { throw "No .nsis.zip.sig found — updater signing did not run" }
          $zip = $sig.FullName -replace '\.sig$', ''
          $zipName = Split-Path $zip -Leaf
          $descriptor = @{
            platform  = "windows-x86_64"
            url       = "https://github.com/SounDoer/PLVS/releases/download/${{ github.ref_name }}/$zipName"
            signature = Get-Content $sig.FullName -Raw
          }
          $descriptor | ConvertTo-Json | Set-Content updater-windows.json
          Copy-Item $zip $zipName

      - name: Upload updater descriptor (tag builds only)
        if: startsWith(github.ref, 'refs/tags/v')
        uses: actions/upload-artifact@v5
        with:
          name: updater-descriptor-windows
          path: updater-windows.json
```

Then add the renamed zip to the existing "Attach installers to GitHub Release" step's `files:` list:

```yaml
      - name: Attach installers to GitHub Release (tags only)
        if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v3
        with:
          body_path: release-notes.md
          files: |
            src-tauri/target/release/bundle/nsis/*.exe
            PLVS-${{ github.ref_name }}-x64-portable.exe
            *.nsis.zip
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 5: Add signing env vars and a descriptor-writing step to `build-macos`**

Similarly for `build-macos`:

```yaml
  build-macos:
    needs: [verify, verify-rust]
    runs-on: macos-latest
    env:
      TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
    steps:
```

Insert after "Build Tauri bundle (DMG)" and before "Smoke test macOS DMG":

```yaml
      - name: Write updater descriptor (tag builds only)
        if: startsWith(github.ref, 'refs/tags/v')
        run: |
          sig=$(ls src-tauri/target/release/bundle/macos/*.app.tar.gz.sig | head -1)
          if [ -z "$sig" ]; then echo "No .app.tar.gz.sig found — updater signing did not run" >&2; exit 1; fi
          tarball="${sig%.sig}"
          tarballName=$(basename "$tarball")
          signature=$(cat "$sig")
          node -e "
            const fs = require('fs');
            fs.writeFileSync('updater-macos.json', JSON.stringify({
              platform: 'darwin-aarch64',
              url: 'https://github.com/SounDoer/PLVS/releases/download/${{ github.ref_name }}/$tarballName',
              signature: process.argv[1],
            }));
          " "$signature"
          cp "$tarball" "$tarballName"

      - name: Upload updater descriptor (tag builds only)
        if: startsWith(github.ref, 'refs/tags/v')
        uses: actions/upload-artifact@v5
        with:
          name: updater-descriptor-macos
          path: updater-macos.json
```

Add the renamed tarball to the existing "Attach DMG to GitHub Release" step:

```yaml
      - name: Attach DMG to GitHub Release (tags only)
        if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v3
        with:
          files: |
            PLVS-${{ github.ref_name }}-aarch64.dmg
            *.app.tar.gz
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 6: Add the `publish-updater-manifest` job**

Append a new job at the end of `.github/workflows/release.yml`:

```yaml
  publish-updater-manifest:
    needs: [build-windows, build-macos]
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v5

      - name: Download Windows descriptor
        uses: actions/download-artifact@v6
        with:
          name: updater-descriptor-windows

      - name: Download macOS descriptor
        uses: actions/download-artifact@v6
        with:
          name: updater-descriptor-macos

      - name: Prepare release notes from CHANGELOG
        run: node scripts/changelog-release-body.mjs "${{ github.ref_name }}" release-notes.md

      - name: Build latest.json
        run: |
          VERSION="${{ github.ref_name }}"
          node scripts/build-updater-manifest.mjs "${VERSION#v}" release-notes.md latest.json updater-windows.json updater-macos.json

      - name: Attach latest.json to GitHub Release
        uses: softprops/action-gh-release@v3
        with:
          files: latest.json
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 7: Run the frontend/CI-adjacent checks locally**

Run: `npx prettier --check scripts/build-updater-manifest.mjs` (fix formatting with `npx prettier --write` if it fails, since `npm run format:check` covers `src/**` only — this script lives outside that glob but should still be readable/consistent).

Run: `npx vitest run scripts/build-updater-manifest.test.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/build-updater-manifest.mjs scripts/build-updater-manifest.test.mjs .github/workflows/release.yml
git commit -m "feat(updater): sign release artifacts and publish latest.json in CI"
```

---

### Task 7: Full local verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full local check suite**

Run: `npm run check`
Expected: PASS (format, lint, test, build, version:check, rust fmt/clippy/test all green). This exercises every file touched above except the CI-only workflow YAML.

- [ ] **Step 2: Manual dry-run of the release workflow**

This can't be scripted locally (it needs the real GitHub Secrets and Actions runners). Once Task 2's secrets are in place:

1. Push a throwaway pre-release tag, e.g. `v0.0.0-updater-test`, or use `workflow_dispatch` on `release.yml` from a branch.
2. Confirm `build-windows` and `build-macos` both produce their `updater-descriptor-*` artifacts and the renamed `.nsis.zip` / `.app.tar.gz` files land on the draft/test release.
3. Confirm `publish-updater-manifest` runs after both and attaches a `latest.json` whose `platforms` object has both `windows-x86_64` and `darwin-aarch64` keys with non-empty `signature` values.
4. Delete the test tag/release afterward (`git push --delete origin v0.0.0-updater-test` + delete the GitHub Release) so it doesn't linger as a fake version users could stumble onto.

- [ ] **Step 3: Report back**

Summarize for the user: what's committed, what's still pending on their side (the two GitHub secrets from Task 2 Step 3, and the dry-run in Step 2 above), and that actual in-app update testing (old build detecting + installing a newer signed one) can only happen once a real tagged release exists with `latest.json` published.
