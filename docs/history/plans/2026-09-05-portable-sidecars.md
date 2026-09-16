# Portable FFmpeg Sidecars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make file analysis work from extracted official and Dev Build Windows Portable ZIPs.

**Architecture:** Expand both existing Portable staging loops to include the two verified FFmpeg release sidecars. Extend text contract tests first, then align public and skill documentation with the four-file bundle.

**Tech Stack:** GitHub Actions YAML, PowerShell, Vitest, Markdown

---

### Task 1: Lock the four-file Portable contract

**Files:**
- Modify: `scripts/releaseWorkflowContract.test.js`
- Modify: `scripts/changelog-release-body.test.mjs`

- [ ] Add assertions that official and Dev workflows stage `ffmpeg.exe` and `ffprobe.exe`.
- [ ] Add assertions that README, Dev Build skill, and generated release notes tell users to keep
      all extracted files together.
- [ ] Run `npm test -- --run scripts/releaseWorkflowContract.test.js scripts/changelog-release-body.test.mjs`.
- [ ] Confirm failures identify the missing sidecars and stale two-file wording.

### Task 2: Package and document the sidecars

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/dev-build.yml`
- Modify: `README.md`
- Modify: `scripts/changelog-release-body.mjs`
- Modify: `skills/plvs-dev-build/SKILL.md`

- [ ] Add `ffmpeg.exe` and `ffprobe.exe` to the official artifact and Portable ZIP staging lists.
- [ ] Copy both sidecars into the Dev Build Portable staging directory.
- [ ] Replace two-file Portable instructions with “keep all extracted files together”.
- [ ] Run the focused tests and confirm they pass.
- [ ] Run `npm run check` and `git diff --check`.
- [ ] Commit with `fix(release): include sidecars in portable ZIPs`.

### Task 3: Verify the real Dev Build artifact

- [ ] Push the branch and trigger `dev-build.yml`.
- [ ] Confirm the workflow conclusion is `success`.
- [ ] Download the rolling Dev Build ZIP and assert it contains all four executables.
- [ ] Run `plvs-cli doctor --json` from the extracted ZIP and confirm both sidecar checks are `ok`.
- [ ] Analyze a generated WAV through the extracted Portable app and confirm completion.
