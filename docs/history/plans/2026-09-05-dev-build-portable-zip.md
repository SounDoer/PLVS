# Dev Build Portable ZIP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the rolling Windows Dev Build Portable artifact as one ZIP containing both the GUI host and CLI forwarder.

**Architecture:** Extend the existing text contract test first, then change only the Dev Build staging step and its skill documentation. Preserve the installer asset, versioning, rolling prerelease, and build identity.

**Tech Stack:** GitHub Actions YAML, PowerShell, Vitest, Markdown

---

### Task 1: Dev Build Portable ZIP

**Files:**
- Modify: `scripts/releaseWorkflowContract.test.js`
- Modify: `.github/workflows/dev-build.yml`
- Modify: `skills/plvs-dev-build/SKILL.md`

- [ ] **Step 1: Write the failing workflow contract test**

Read `.github/workflows/dev-build.yml` and `skills/plvs-dev-build/SKILL.md`, then assert that the
workflow stages both binaries, invokes `Compress-Archive`, names a Portable ZIP, omits the old
Portable EXE filename, and that the skill documents the ZIP and both sibling executables.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run scripts/releaseWorkflowContract.test.js`

Expected: FAIL because the Dev Build still copies only `plvs.exe` to a Portable EXE asset.

- [ ] **Step 3: Implement the Portable ZIP staging**

In the existing staging PowerShell, create a versioned Portable directory, copy `plvs.exe` and
`plvs-cli.exe` into it, and compress its contents to
`dev-dist/PLVS-v${label}-x64-portable.zip`.

- [ ] **Step 4: Update the skill contract**

Describe the workflow output as a Portable ZIP and list the ZIP filename plus its two files.

- [ ] **Step 5: Verify GREEN and the repository gate**

Run:

```bash
npm test -- --run scripts/releaseWorkflowContract.test.js
npm run check
git diff --check
```

Expected: all commands exit zero.

- [ ] **Step 6: Commit**

```bash
git add scripts/releaseWorkflowContract.test.js .github/workflows/dev-build.yml skills/plvs-dev-build/SKILL.md
git commit -m "fix(release): bundle CLI with dev portable"
```
