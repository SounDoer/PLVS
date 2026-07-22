# Update Changelog Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a Markdown changelog confirmation modal before any updater download, then install and relaunch only after explicit confirmation.

**Architecture:** Keep update discovery in `checkForUpdate`, asynchronous install/relaunch state in `useApplyUpdate`, and presentation in a dedicated `UpdateDialog`. `AppSettingsOverlays` coordinates the Settings button and dialog without moving Tauri calls into components. The release workflow will give `latest.json` a changelog-only notes file while preserving the full GitHub Release body.

**Tech Stack:** React 19, Radix Dialog, `react-markdown`, Vitest/Testing Library, Tauri updater/process plugins, Node.js release scripts, GitHub Actions.

---

## File map

**Create**

- `src/components/UpdateDialog.jsx` — update confirmation, Markdown display, busy/error states, and actions.
- `src/components/UpdateDialog.test.jsx` — component behavior, Markdown safety, and external links.
- `scripts/changelog-release-body.test.mjs` — full-release and changelog-only CLI behavior.

**Modify**

- `scripts/changelog-release-body.mjs` — add strict `--changelog-only` output.
- `.github/workflows/release.yml` — use changelog-only notes for `latest.json`.
- `src/lib/updateCheck.js` — expose Tauri `Update.body`.
- `src/lib/updateCheck.test.js` — cover release-note mapping.
- `src/hooks/useApplyUpdate.js` — install, automatic relaunch, retry, and reset states.
- `src/hooks/useApplyUpdate.test.js` — cover the updater state machine.
- `package.json` and `package-lock.json` — add `react-markdown`.
- `src/components/AppSettingsOverlays.jsx` — own and wire the update dialog.
- `src/components/AppSettingsOverlays.test.jsx` — prove Update opens the dialog before install.
- `src/components/SettingsPanel.jsx` — keep only update availability and the dialog trigger in the footer.
- `src/components/SettingsPanel.test.jsx` — remove obsolete footer install/restart cases.
- `src/App.jsx` — pass the revised update actions into the overlay coordinator.

**Deliberately unchanged**

- `scripts/build-updater-manifest.mjs` — already copies the supplied notes file into `latest.json.notes`.
- `src/hooks/useUpdateCheck.js` — already preserves all fields returned by `checkForUpdate`.
- Rust updater registration, Tauri capabilities, and audio capture code.

---

### Task 1: Produce changelog-only updater notes

**Files:**
- Create: `scripts/changelog-release-body.test.mjs`
- Modify: `scripts/changelog-release-body.mjs`
- Modify: `.github/workflows/release.yml:276-282`

- [ ] **Step 1: Write failing CLI tests**

Create `scripts/changelog-release-body.test.mjs`:

```js
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "changelog-release-body.mjs");

function run(version, outFile, ...args) {
  return execFileSync(process.execPath, [script, version, outFile, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
}

describe("changelog-release-body", () => {
  it("keeps installation instructions in the default GitHub Release body", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-body-"));
    const outFile = join(dir, "release.md");

    run("v0.9.4", outFile);

    const body = readFileSync(outFile, "utf8");
    expect(body).toContain("### Added");
    expect(body).toContain("## 安装");
    expect(body).toContain("## Installation");
  });

  it("writes only the tagged changelog section in changelog-only mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "updater-notes-"));
    const outFile = join(dir, "updater.md");

    run("v0.9.4", outFile, "--changelog-only");

    const body = readFileSync(outFile, "utf8");
    expect(body).toContain("### Added");
    expect(body).not.toContain("## 安装");
    expect(body).not.toContain("## Installation");
  });

  it("fails changelog-only generation when the tagged section is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "updater-notes-missing-"));
    const outFile = join(dir, "updater.md");

    expect(() => run("v999.999.999", outFile, "--changelog-only")).toThrow();
    expect(existsSync(outFile)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the CLI tests and confirm the new behavior is absent**

Run:

```bash
npx vitest run scripts/changelog-release-body.test.mjs
```

Expected: the default-body test passes; the two `--changelog-only` tests fail because the script ignores the mode and writes fallback/install content.

- [ ] **Step 3: Add strict changelog-only mode**

In `scripts/changelog-release-body.mjs`, replace argument parsing and usage validation with:

```js
const tagArg = process.argv[2] ?? "";
const outFile = process.argv[3] ?? "";
const mode = process.argv[4] ?? "";
const changelogOnly = mode === "--changelog-only";
const semver = tagArg.replace(/^v/i, "").trim();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const changelogPath = join(root, "CHANGELOG.md");

if (!semver || !outFile || (mode && !changelogOnly)) {
  console.error(
    "Usage: node scripts/changelog-release-body.mjs <tag> <outfile.md> [--changelog-only]"
  );
  process.exit(1);
}
```

Replace the missing-section branch with:

```js
if (idx === -1) {
  if (changelogOnly) {
    console.error(`Missing CHANGELOG.md section: ## [${semver}]`);
    process.exit(1);
  }

  body = [
    `## PLVS v${semver}`,
    "",
    `See [CHANGELOG.md](https://github.com/SounDoer/PLVS/blob/main/CHANGELOG.md) on \`main\` for the full history.`,
    "",
    `_No dedicated section found for this tag in CHANGELOG.md — add \`## [${semver}]\` before tagging._`,
  ].join("\n");
} else {
  const lineEnd = changelog.indexOf("\n", idx);
  const afterHeader =
    lineEnd === -1 ? changelog.slice(idx + headerNeedle.length) : changelog.slice(lineEnd + 1);
  const nextIdx = afterHeader.search(/\n## \[/);
  body = (nextIdx === -1 ? afterHeader : afterHeader.slice(0, nextIdx)).trim();
}
```

Replace the final write with:

```js
const output = changelogOnly ? `${body}\n` : `${body}\n${installSection}\n`;
writeFileSync(outFile, output, "utf8");
```

- [ ] **Step 4: Point the updater manifest job at strict notes**

Replace `.github/workflows/release.yml:276-282` with:

```yaml
      - name: Prepare updater changelog
        run: node scripts/changelog-release-body.mjs "${{ github.ref_name }}" updater-notes.md --changelog-only

      - name: Build latest.json
        run: |
          VERSION="${{ github.ref_name }}"
          node scripts/build-updater-manifest.mjs "${VERSION#v}" updater-notes.md latest.json updater-windows.json updater-macos.json
```

Do not change the earlier GitHub Release body generation at lines 163-171; it must continue using the default mode and include installation instructions.

- [ ] **Step 5: Format and rerun the CLI tests**

Run:

```bash
npx prettier --write scripts/changelog-release-body.mjs scripts/changelog-release-body.test.mjs .github/workflows/release.yml
npx vitest run scripts/changelog-release-body.test.mjs scripts/build-updater-manifest.test.mjs
```

Expected: 4 tests pass across the two files. The generated changelog-only body excludes both installation sections.

- [ ] **Step 6: Commit the release-pipeline slice**

```bash
git add scripts/changelog-release-body.mjs scripts/changelog-release-body.test.mjs .github/workflows/release.yml
git commit -m "fix(release): keep updater notes focused on changes"
```

---

### Task 2: Expose release notes from the updater check

**Files:**
- Modify: `src/lib/updateCheck.test.js:15-25`
- Modify: `src/lib/updateCheck.js:14-25`

- [ ] **Step 1: Add a failing release-note mapping assertion**

Replace the first test in `src/lib/updateCheck.test.js` with:

```js
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
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx vitest run src/lib/updateCheck.test.js
```

Expected: FAIL because `releaseNotes` is absent from the result.

- [ ] **Step 3: Map `Update.body` into the check result**

Add the field in the update-present return object in `src/lib/updateCheck.js`:

```js
return {
  hasUpdate: true,
  latestVersion: update.version,
  releaseNotes: update.body ?? "",
  releaseUrl: RELEASES_URL,
  update,
};
```

Do not add a second network request. `useUpdateCheck` already spreads this field into `updateInfo`.

- [ ] **Step 4: Rerun the focused test**

Run:

```bash
npx vitest run src/lib/updateCheck.test.js src/hooks/useUpdateCheck.test.js
```

Expected: all update-check tests pass.

- [ ] **Step 5: Commit the metadata slice**

```bash
git add src/lib/updateCheck.js src/lib/updateCheck.test.js
git commit -m "feat(updater): expose release notes to the UI"
```

---

### Task 3: Install and relaunch through an explicit state machine

**Files:**
- Modify: `src/hooks/useApplyUpdate.test.js`
- Modify: `src/hooks/useApplyUpdate.js`

The hook states after this task are:

- `idle`
- `installing`
- `restarting`
- `install-error`
- `restart-error`

`restarting` remains active if the mocked `relaunch()` resolves. In the real app,
successful relaunch terminates the current process, so no subsequent stable UI
state is needed.

- [ ] **Step 1: Replace hook tests with the target behavior**

Keep the existing imports and updater-process mock, then replace the
`describe("useApplyUpdate", ...)` body with:

```js
describe("useApplyUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts idle", () => {
    const { result } = renderHook(() => useApplyUpdate());
    expect(result.current.installStatus).toBe("idle");
  });

  it("stays installing until downloadAndInstall completes", async () => {
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
      void result.current.install(update);
    });
    expect(result.current.installStatus).toBe("installing");

    relaunchMock.mockResolvedValue();
    await act(async () => {
      resolveInstall();
    });
    await waitFor(() => expect(relaunchMock).toHaveBeenCalledTimes(1));
  });

  it("automatically relaunches after a successful installation", async () => {
    const update = { downloadAndInstall: vi.fn().mockResolvedValue() };
    relaunchMock.mockResolvedValue();
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(update);
    });

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    expect(result.current.installStatus).toBe("restarting");
  });

  it("reports an install error without trying to relaunch", async () => {
    const update = { downloadAndInstall: vi.fn().mockRejectedValue(new Error("download failed")) };
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(update);
    });

    expect(result.current.installStatus).toBe("install-error");
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("reports a restart error after installation succeeds", async () => {
    const update = { downloadAndInstall: vi.fn().mockResolvedValue() };
    relaunchMock.mockRejectedValueOnce(new Error("relaunch failed"));
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(update);
    });

    expect(result.current.installStatus).toBe("restart-error");
  });

  it("retries only relaunch after a restart error", async () => {
    const update = { downloadAndInstall: vi.fn().mockResolvedValue() };
    relaunchMock
      .mockRejectedValueOnce(new Error("relaunch failed"))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(update);
    });
    await act(async () => {
      await result.current.restartToApply();
    });

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(2);
    expect(result.current.installStatus).toBe("restarting");
  });

  it("resets a dismissed error before the dialog is reopened", async () => {
    const update = { downloadAndInstall: vi.fn().mockRejectedValue(new Error("download failed")) };
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(update);
    });
    act(() => {
      result.current.resetInstall();
    });

    expect(result.current.installStatus).toBe("idle");
  });

  it("does nothing when install is called without an update handle", async () => {
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(null);
    });

    expect(result.current.installStatus).toBe("idle");
    expect(relaunchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the hook test and verify it fails**

Run:

```bash
npx vitest run src/hooks/useApplyUpdate.test.js
```

Expected: failures for automatic relaunch, the new status names, and
`resetInstall`.

- [ ] **Step 3: Implement the minimal updater state machine**

Replace `useApplyUpdate` in `src/hooks/useApplyUpdate.js` with:

```js
export function useApplyUpdate() {
  const [installStatus, setInstallStatus] = useState("idle");

  const restartToApply = useCallback(async () => {
    setInstallStatus("restarting");
    try {
      await relaunch();
    } catch {
      setInstallStatus("restart-error");
    }
  }, []);

  const install = useCallback(
    async (update) => {
      if (!update) return;

      setInstallStatus("installing");
      try {
        await update.downloadAndInstall();
      } catch {
        setInstallStatus("install-error");
        return;
      }

      await restartToApply();
    },
    [restartToApply]
  );

  const resetInstall = useCallback(() => {
    setInstallStatus("idle");
  }, []);

  return { installStatus, install, restartToApply, resetInstall };
}
```

- [ ] **Step 4: Run the hook test**

Run:

```bash
npx vitest run src/hooks/useApplyUpdate.test.js
```

Expected: all hook tests pass.

- [ ] **Step 5: Commit the updater state machine**

```bash
git add src/hooks/useApplyUpdate.js src/hooks/useApplyUpdate.test.js
git commit -m "feat(updater): relaunch automatically after install"
```

---

### Task 4: Build the changelog confirmation dialog

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/components/UpdateDialog.test.jsx`
- Create: `src/components/UpdateDialog.jsx`

- [ ] **Step 1: Add the Markdown renderer**

Run:

```bash
npm install react-markdown
```

Expected: `react-markdown` appears in `dependencies`, and `package-lock.json`
records the resolved current version. Do not add `rehype-raw`; raw release HTML
must remain disabled.

- [ ] **Step 2: Write failing dialog tests**

Create `src/components/UpdateDialog.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UpdateDialog } from "./UpdateDialog.jsx";

const BASE_PROPS = {
  open: true,
  version: "0.9.5",
  releaseNotes: "### Fixed\n- Safer updates",
  installStatus: "idle",
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
  onRestart: vi.fn(),
  openExternalUrl: vi.fn(),
};

describe("UpdateDialog", () => {
  it("renders nothing when closed", () => {
    render(<UpdateDialog {...BASE_PROPS} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the version and basic Markdown without rendering raw HTML", () => {
    const { container } = render(
      <UpdateDialog
        {...BASE_PROPS}
        releaseNotes={"### Fixed\n- Safer updates\n\n<span data-unsafe>unsafe</span>"}
      />
    );

    expect(screen.getByText("What's new in v0.9.5")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Fixed" })).toBeTruthy();
    expect(screen.getByText("Safer updates")).toBeTruthy();
    expect(container.querySelector("[data-unsafe]")).toBeNull();
  });

  it("opens Markdown links through the external URL handler", () => {
    const openExternalUrl = vi.fn();
    render(
      <UpdateDialog
        {...BASE_PROPS}
        releaseNotes="[Full notes](https://example.com/release)"
        openExternalUrl={openExternalUrl}
      />
    );

    fireEvent.click(screen.getByRole("link", { name: "Full notes" }));
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/release");
  });

  it("cancels without confirming", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<UpdateDialog {...BASE_PROPS} onCancel={onCancel} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("dismisses with Escape before installation starts", () => {
    const onCancel = vi.fn();
    render(<UpdateDialog {...BASE_PROPS} onCancel={onCancel} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("dismisses from the overlay before installation starts", () => {
    const onCancel = vi.fn();
    render(<UpdateDialog {...BASE_PROPS} onCancel={onCancel} />);

    fireEvent.click(screen.getByTestId("update-overlay"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("starts the update only from Update and Restart", () => {
    const onConfirm = vi.fn();
    render(<UpdateDialog {...BASE_PROPS} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Update and Restart" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("locks dismissal and submission while installing", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <UpdateDialog
        {...BASE_PROPS}
        installStatus="installing"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole("button", { name: "Cancel" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Updating..." }).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("update-overlay"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("offers full retry after an installation failure", () => {
    const onConfirm = vi.fn();
    render(<UpdateDialog {...BASE_PROPS} installStatus="install-error" onConfirm={onConfirm} />);

    expect(screen.getByText("Update failed. Please try again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("offers restart-only retry after a relaunch failure", () => {
    const onRestart = vi.fn();
    render(
      <UpdateDialog {...BASE_PROPS} installStatus="restart-error" onRestart={onRestart} />
    );

    expect(screen.getByText("Update installed. Restart PLVS to finish.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the dialog test and verify it fails**

Run:

```bash
npx vitest run src/components/UpdateDialog.test.jsx
```

Expected: FAIL because `UpdateDialog.jsx` does not exist.

- [ ] **Step 4: Implement the dialog**

Create `src/components/UpdateDialog.jsx`:

```jsx
import * as Dialog from "@radix-ui/react-dialog";
import ReactMarkdown from "react-markdown";

const SECONDARY_BUTTON_CLASS =
  "rounded-md px-2 py-0.5 text-[length:var(--ui-fs-control)] text-muted-foreground transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-50";
const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-primary px-2 py-0.5 text-[length:var(--ui-fs-control)] text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60";

export function UpdateDialog({
  open,
  version,
  releaseNotes,
  installStatus = "idle",
  onConfirm,
  onCancel,
  onRestart,
  openExternalUrl,
}) {
  const installing = installStatus === "installing";
  const restarting = installStatus === "restarting";
  const installFailed = installStatus === "install-error";
  const restartFailed = installStatus === "restart-error";
  const busy = installing || restarting;

  const primaryLabel = restarting
    ? "Restarting..."
    : installing
      ? "Updating..."
      : restartFailed
        ? "Restart"
        : installFailed
          ? "Retry"
          : "Update and Restart";

  function handlePrimary() {
    if (busy) return;
    if (restartFailed) {
      onRestart();
      return;
    }
    onConfirm();
  }

  function handleDismiss() {
    if (!busy) onCancel();
  }

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="update-overlay"
          className="fixed inset-0 z-50 bg-black/60"
          onClick={handleDismiss}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-card p-3 shadow-xl focus:outline-none"
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            handleDismiss();
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
          }}
        >
          <Dialog.Title className="text-[length:var(--ui-fs-control)] font-semibold text-foreground">
            Update available
          </Dialog.Title>
          <Dialog.Description className="mt-0.5 text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
            What&apos;s new in v{version}
          </Dialog.Description>

          <div className="my-3 max-h-[50vh] overflow-y-auto rounded-md border border-border/60 bg-background/35 px-3 py-2 text-[length:var(--ui-fs-control)] text-foreground/90 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-semibold [&_hr]:my-3 [&_hr]:border-border [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-secondary [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5">
            <ReactMarkdown
              components={{
                a: ({ href, children }) => (
                  <a
                    href={href}
                    onClick={(event) => {
                      event.preventDefault();
                      void openExternalUrl(href);
                    }}
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {releaseNotes}
            </ReactMarkdown>
          </div>

          {installFailed ? (
            <p className="mb-2 text-[length:var(--ui-fs-control)] text-destructive">
              Update failed. Please try again.
            </p>
          ) : null}
          {restartFailed ? (
            <p className="mb-2 text-[length:var(--ui-fs-control)] text-destructive">
              Update installed. Restart PLVS to finish.
            </p>
          ) : null}

          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={handleDismiss}
              className={SECONDARY_BUTTON_CLASS}
            >
              {restartFailed ? "Close" : "Cancel"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handlePrimary}
              className={PRIMARY_BUTTON_CLASS}
            >
              {primaryLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

If the repository's formatter wraps the nested `primaryLabel` expression
differently, accept the formatter output rather than hand-formatting around it.

- [ ] **Step 5: Run and format the component tests**

Run:

```bash
npx prettier --write src/components/UpdateDialog.jsx src/components/UpdateDialog.test.jsx
npx vitest run src/components/UpdateDialog.test.jsx
```

Expected: all `UpdateDialog` tests pass.

- [ ] **Step 6: Commit the dialog slice**

```bash
git add package.json package-lock.json src/components/UpdateDialog.jsx src/components/UpdateDialog.test.jsx
git commit -m "feat(updater): add changelog confirmation dialog"
```

---

### Task 5: Route the Settings Update action through the dialog

**Files:**
- Modify: `src/components/AppSettingsOverlays.test.jsx`
- Modify: `src/components/AppSettingsOverlays.jsx`
- Modify: `src/components/SettingsPanel.test.jsx:355-411`
- Modify: `src/components/SettingsPanel.jsx:151-225,664-719`
- Modify: `src/App.jsx:444-445,1339-1345`

- [ ] **Step 1: Extend overlay mocks for a failing wiring test**

In the `SettingsPanel` mock in `AppSettingsOverlays.test.jsx`, accept
`onInstallUpdate` and add an Update button:

```jsx
SettingsPanel: ({
  onOpenFeedback,
  onInstallUpdate,
  themeControlsDisabled,
  cliPathStatus,
  interfaceSize,
  setInterfaceSize,
}) => (
  <div data-testid="settings-panel">
    <span data-testid="theme-disabled">{String(themeControlsDisabled)}</span>
    <span data-testid="cli-status">{cliPathStatus}</span>
    <span data-testid="interface-size">{interfaceSize}</span>
    <button type="button" onClick={() => setInterfaceSize("large")}>
      Set interface size
    </button>
    <button type="button" onClick={onInstallUpdate}>
      Update
    </button>
    <button type="button" onClick={onOpenFeedback}>
      Feedback
    </button>
  </div>
),
```

Add this component mock after the other component mocks:

```jsx
vi.mock("./UpdateDialog.jsx", () => ({
  UpdateDialog: ({ open, version, releaseNotes, onConfirm, onCancel }) =>
    open ? (
      <div role="dialog" aria-label="update">
        <span>{version}</span>
        <span>{releaseNotes}</span>
        <button type="button" onClick={onCancel}>
          Cancel update
        </button>
        <button type="button" onClick={onConfirm}>
          Confirm update
        </button>
      </div>
    ) : null,
}));
```

Change `renderOverlays` to accept update-control overrides and return the
constructed controls:

```jsx
function renderOverlays(settings = makeSettings(), updateOverrides = {}) {
  const updateControls = {
    updateInfo: null,
    refreshUpdateCheck: vi.fn(),
    installStatus: "idle",
    install: vi.fn(),
    restartToApply: vi.fn(),
    resetInstall: vi.fn(),
    ...updateOverrides,
  };

  const view = render(
    <AppSettingsOverlays
      settings={settings}
      channelSettings={{
        channelCount: 2,
        channelLabelTokens: [],
        channelLabelHasOverride: false,
        setChannelLabelToken: vi.fn(),
        resetChannelLabels: vi.fn(),
      }}
      updateControls={updateControls}
      appVersion="0.0.0"
    />
  );

  return { ...view, updateControls };
}
```

Add the integration test:

```jsx
it("opens the changelog dialog before starting an update", () => {
  const update = { downloadAndInstall: vi.fn() };
  const install = vi.fn();
  const resetInstall = vi.fn();
  renderOverlays(makeSettings(), {
    updateInfo: {
      hasUpdate: true,
      latestVersion: "0.9.5",
      releaseNotes: "### Fixed",
      update,
    },
    install,
    resetInstall,
  });

  fireEvent.click(screen.getByRole("button", { name: "Update" }));

  expect(screen.getByRole("dialog", { name: "update" })).toBeTruthy();
  expect(screen.getByText("0.9.5")).toBeTruthy();
  expect(screen.getByText("### Fixed")).toBeTruthy();
  expect(resetInstall).toHaveBeenCalledTimes(1);
  expect(install).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Confirm update" }));
  expect(install).toHaveBeenCalledWith(update);
});
```

- [ ] **Step 2: Update the Settings footer test contract**

In `src/components/SettingsPanel.test.jsx`, replace the Update-button test with:

```jsx
it("shows an Update button when an update is available and requests its dialog", () => {
  const onInstallUpdate = vi.fn();
  render(
    <SettingsPanel
      {...BASE_PROPS}
      appVersion="0.1.9"
      latestVersion="0.1.10"
      hasUpdate={true}
      onInstallUpdate={onInstallUpdate}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Update" }));
  expect(onInstallUpdate).toHaveBeenCalledTimes(1);
});
```

Delete the obsolete tests named:

- `disables the Update button and shows progress while installing`
- `shows a Restart button once the update is ready and calls onRestartToApply`

Keep the no-update test unchanged.

- [ ] **Step 3: Run the integration tests and verify they fail**

Run:

```bash
npx vitest run src/components/AppSettingsOverlays.test.jsx src/components/SettingsPanel.test.jsx
```

Expected: the overlay test fails because no `UpdateDialog` is rendered. The
updated Settings contract test remains green while the obsolete production
props and branches still await removal.

- [ ] **Step 4: Simplify the Settings footer**

Remove `installStatus` and `onRestartToApply` from the `SettingsPanel` props.

Replace the update status calculation with:

```js
const updateCheckDisabled = updateStatus === "checking";
let updateStatusText = "Checking...";
if (updateStatus === "unavailable") {
  updateStatusText = "Update unavailable";
} else if (updateStatus === "ok") {
  updateStatusText = hasUpdate && latestVersion ? `v${latestVersion} available` : "Up to date";
}
```

Replace the conditional update/restart controls at lines 691-719 with:

```jsx
{hasUpdate ? (
  <>
    <span className="shrink-0 text-muted-foreground/30">&middot;</span>
    <button
      type="button"
      className={cn(FOOTER_LINK_CLASS, "text-primary hover:text-primary")}
      onClick={onInstallUpdate}
    >
      Update
    </button>
  </>
) : null}
```

- [ ] **Step 5: Wire dialog ownership in `AppSettingsOverlays`**

Add the import:

```js
import { UpdateDialog } from "./UpdateDialog.jsx";
```

Add dialog state and update-control destructuring near the top:

```js
const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
const {
  updateInfo,
  refreshUpdateCheck,
  installStatus,
  install,
  restartToApply,
  resetInstall,
} = updateControls;
```

Add these handlers before the return:

```js
function openUpdateDialog() {
  resetInstall();
  setUpdateDialogOpen(true);
}

function closeUpdateDialog() {
  resetInstall();
  setUpdateDialogOpen(false);
}
```

Change the Settings update props to:

```jsx
onCheckForUpdate={refreshUpdateCheck}
onInstallUpdate={openUpdateDialog}
```

Remove `installStatus={installStatus}` and
`onRestartToApply={restartToApply}` from `SettingsPanel`.

After `SettingsPanel`, render:

```jsx
<UpdateDialog
  open={updateDialogOpen}
  version={updateInfo?.latestVersion}
  releaseNotes={updateInfo?.releaseNotes}
  installStatus={installStatus}
  onConfirm={() => install(updateInfo?.update)}
  onCancel={closeUpdateDialog}
  onRestart={restartToApply}
  openExternalUrl={openExternalUrl}
/>
```

- [ ] **Step 6: Pass the reset action from `App`**

Replace the hook destructuring at `src/App.jsx:445` with:

```js
const { installStatus, install, restartToApply, resetInstall } = useApplyUpdate();
```

Add `resetInstall` to the `updateControls` object:

```jsx
updateControls={{
  updateInfo,
  refreshUpdateCheck,
  installStatus,
  install,
  restartToApply,
  resetInstall,
}}
```

- [ ] **Step 7: Run and format the integrated frontend tests**

Run:

```bash
npx prettier --write src/App.jsx src/components/AppSettingsOverlays.jsx src/components/AppSettingsOverlays.test.jsx src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx
npx vitest run src/components/UpdateDialog.test.jsx src/components/AppSettingsOverlays.test.jsx src/components/SettingsPanel.test.jsx src/hooks/useApplyUpdate.test.js src/lib/updateCheck.test.js
```

Expected: all listed suites pass. Clicking the Settings Update button is proven
not to call `install` until dialog confirmation.

- [ ] **Step 8: Commit the integration slice**

```bash
git add src/App.jsx src/components/AppSettingsOverlays.jsx src/components/AppSettingsOverlays.test.jsx src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx
git commit -m "feat(updater): confirm changes before installation"
```

---

### Task 6: Verify the complete change

**Files:**
- Verify all files changed by Tasks 1-5

- [ ] **Step 1: Review the complete diff for scope**

Run:

```bash
git status --short
git diff --check
git diff 97525ad2..HEAD --stat
```

Expected: only updater UI, updater tests, release-note generation, workflow,
dependency manifests, and plan-driven documentation are changed. No generated
theme file, Rust file, or audio capture file is touched.

- [ ] **Step 2: Run the complete merge gate**

Run:

```bash
npm run check
```

Expected: version check, formatting, ESLint, Vitest, frontend build, Rust
format, Clippy, and Rust tests all pass.

If a fresh worktree reports a missing FFmpeg sidecar during the Rust half, run:

```bash
npm run ffmpeg:fetch
npm run check
```

Do not debug `serde_derive`; the missing verified sidecar is the known cause.

- [ ] **Step 3: Perform signed-updater acceptance testing**

Use an installed signed PLVS build whose version is older than the updater
manifest. A Vite-only browser session cannot exercise the Tauri updater.

Verify this checklist in `npm run desktop` or an installed release build with a
valid signed update available:

1. Settings shows **Update**.
2. Clicking it opens the modal and does not start the updater.
3. The modal shows only that release's changelog, not manual installation text.
4. Cancel, Escape, and overlay dismissal close the idle modal.
5. **Update and Restart** locks the modal and begins the update.
6. A successful update relaunches into the new version.
7. A deliberately failed download/signature check leaves **Retry** available.

The automated hook tests cover relaunch failure because forcing the OS relaunch
API to fail safely in a packaged acceptance run is not reliable.

- [ ] **Step 4: Record verification evidence**

Add the exact `npm run check` result and signed-updater acceptance result to the
implementation handoff or pull-request test plan. Do not claim manual updater
success if only mocked Vitest coverage ran.
