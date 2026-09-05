# Windows Portable CLI Bundle Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a Windows Portable ZIP containing both the GUI host and its CLI forwarder.

**Architecture:** Add a source-contract test for the Release workflow and current README. Stage the
two release binaries under their required original names, compress them into one tag-named ZIP, and
attach that ZIP instead of a renamed standalone executable.

**Tech Stack:** GitHub Actions, PowerShell, Vitest

---

### Task 1: Lock the Portable Release contract

**Files:**

- Create: `scripts/releaseWorkflowContract.test.js`

- [x] Read `.github/workflows/release.yml` and `README.md`, then assert:

```js
expect(releaseWorkflow).toContain("src-tauri/target/release/plvs.exe");
expect(releaseWorkflow).toContain("src-tauri/target/release/plvs-cli.exe");
expect(releaseWorkflow).toContain("Compress-Archive");
expect(releaseWorkflow).toContain("PLVS-${{ github.ref_name }}-x64-portable.zip");
expect(releaseWorkflow).not.toContain("PLVS-${{ github.ref_name }}-x64-portable.exe");
expect(readme).toContain("PLVS_x64-portable.zip");
```

- [x] Run:

```powershell
npm test -- --run scripts/releaseWorkflowContract.test.js
```

Expected: FAIL because the workflow and README still describe one Portable EXE.

### Task 2: Build and document the ZIP

**Files:**

- Modify: `.github/workflows/release.yml`
- Modify: `README.md`

- [x] Upload `plvs.exe` and `plvs-cli.exe` together for workflow-dispatch artifacts.

- [x] For tag builds, verify both source files, copy them unchanged into a staging directory, and
      run:

```powershell
Compress-Archive -Path "$bundleDir\*" -DestinationPath "$bundleDir.zip"
```

- [x] Attach `PLVS-${{ github.ref_name }}-x64-portable.zip` to the GitHub Release and remove the old
      Portable EXE attachment.

- [x] Change the README package table to `PLVS_x64-portable.zip` and explain that users extract the
      archive, launch `plvs.exe`, and keep `plvs-cli.exe` beside it.

- [x] Re-run the focused contract test and confirm it passes.

- [x] Run:

```powershell
npm run check
git diff --check
```

Expected: the complete merge gate and whitespace validation pass.

- [x] Commit:

```powershell
git add .github/workflows/release.yml README.md scripts/releaseWorkflowContract.test.js docs/superpowers/plans/2026-09-05-windows-portable-cli-bundle-fix.md
git commit -m "fix(release): bundle CLI with Windows portable"
```
