# CLI Current Documentation Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every current CLI installation, development, and capture-rig instruction match CLI
v1 and the new Portable ZIP.

**Architecture:** Add a source-contract test over the four current documentation surfaces, then
replace only the identified stale statements.

**Tech Stack:** Markdown, HTML, Vitest

---

### Task 1: Lock current CLI documentation

**Files:**

- Create: `scripts/cliDocumentationContract.test.js`

- [x] Read README, landing docs, CONTRIBUTING, and AGENTS and assert:

```js
expect(landing).not.toContain("Installer builds add");
expect(landing).toContain("Enabling Agent Control");
expect(contributing).not.toContain("release CLI 不显示 `app` 命令");
expect(contributing).toContain("plvs-cli.exe");
expect(agents).not.toContain("plvs-cli devices");
expect(agents).toContain("device-enumeration");
expect(agents).toContain("capture-harness");
```

- [x] Run:

```powershell
npm test -- --run scripts/cliDocumentationContract.test.js
```

Expected: FAIL on the stale landing, CONTRIBUTING, and AGENTS text.

### Task 2: Correct current documentation

**Files:**

- Modify: `landing/docs/index.html`
- Modify: `CONTRIBUTING.md`
- Modify: `AGENTS.md`

- [x] Explain the opt-in PATH behavior and Portable sibling invocation in landing docs.
- [x] Correct the Release `app` support and Portable ZIP/raw binary description in CONTRIBUTING.
- [x] Replace the removed device command and update capture trigger/harness checks in AGENTS.
- [x] Re-run the focused contract test and confirm it passes.
- [x] Run `npm run check` and `git diff --check`.
- [x] Commit with `docs(cli): align current CLI guidance`.
