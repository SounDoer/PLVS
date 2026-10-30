---
name: "plvs-deps-update"
description: "Applies the open Dependabot proposals to main: compatible updates are applied, license-reviewed, gated and pushed; incompatible ones and license problems are reported. Use for the weekly scheduled run or when asked to handle dependency updates or Dependabot pull requests."
---

# PLVS Dependency Update

Dependabot opens its pull requests every Monday at 03:00 (Asia/Shanghai, `.github/dependabot.yml`).
They are proposals only and are never merged: main keeps a linear history, and Dependabot cannot
record the license review that `npm run licenses:check` requires, so their CI is always red. This
skill applies the proposals as one commit on main and lets Dependabot close its own pull requests
once main is up to date.

It normally runs unattended every Monday morning as a Claude desktop scheduled task (see
[Scheduled run](#scheduled-run)). The maintainer reads the report afterwards.

## Authority

The maintainer decided on 2026-10-30 that this skill may push its commit to `origin/main` without
asking, when every condition under [Push](#push) holds. That authority covers only the dependency
commit this skill produces. Anything outside the rules below is reported, not decided.

## 1. Prepare an isolated worktree

Other sessions may be working in the main checkout. Never apply updates there.

```bash
git fetch origin
git worktree add .claude/worktrees/deps-<yyyy-mm-dd> -b deps/<yyyy-mm-dd> origin/main
cd .claude/worktrees/deps-<yyyy-mm-dd>
npm run worktree:setup
```

The branch is temporary: the commit lands on main by pushing `HEAD:main`, and the worktree and
branch are removed at the end.

## 2. Collect and classify

```bash
gh pr list --author app/dependabot --state open --json number,title,files,body
```

A grouped pull request lists several packages; classify each package separately.

- **Compatible** — the new version stays in the same semver-compatible range: same major for
  `>= 1.0`, same minor for `0.x`, same patch for `0.0.x`. Apply it. A newer release in the same
  range is fine. The `rust-toolchain` channel is compatible within `1.x`.
- **Incompatible** — anything else (for example `vitest` 4 → 5, `rusqlite` 0.40 → 0.41). Do not
  apply it. Estimate the effort for the report: read the release notes or changelog, and count the
  call sites (`rg` for the crate or import name).

Apply with the package managers, never by editing lockfiles:

```bash
npm install <pkg>@^<version>            # add -D for devDependencies
cargo update --manifest-path src-tauri/Cargo.toml -p <crate> --precise <version>
```

Raise the requirement in a `Cargo.toml` only when the lockfile cannot reach the version otherwise.
For `rust-toolchain`, edit `channel` in `rust-toolchain.toml`. Then confirm with a lockfile diff that
nothing beyond the intended packages and their transitive dependencies moved.

**Capture layer.** An update to a crate imported under `src-tauri/src/audio`, `dsp` or `engine`
(`rg -o '^use \w+' src-tauri/src/{audio,dsp,engine} | sort -u`; for example `cpal`, `rubato`,
`realfft`) is applied normally but called out in the report: CI cannot exercise it, so the next
release's `smoke:capture` is its first real test, and a `soak:capture` is worth scheduling.

## 3. License review

Follow [docs/dependency-license-review.md](../../../docs/dependency-license-review.md). Its section
"Unattended weekly updates" defines which changes this skill may accept on its own; anything outside
it is a stop condition.

```bash
node scripts/generate-component-notices.mjs --candidate > <scratch>/candidate.json
```

Compare `components` and `tools` in the candidate against `licenses/component-sources.json` and
check every added entry against those rules. For a package that hits a stop condition, revert it to
its current version (`npm install <pkg>@<old>` / `cargo update --precise <old>`), regenerate the
candidate, and report it under "needs a decision".

Write the record without reformatting it (it is not Prettier-formatted, and `--check` compares
`tools` byte for byte):

- `tools`: take the candidate's `tools` object verbatim; it is already in the required order.
- `components`: keep the existing order, put each new version where its previous version was, and
  keep every unchanged entry exactly as it is, including `supplements` and `localFiles`.
- `licenses/native-components.json`: rename the version in a key only when the rules allow it.

Then:

```bash
npm run licenses:generate
npm run licenses:check
```

Check the exit status of every command; do not pipe a gate through `tail` without `pipefail`.

## 4. Gate

```bash
npm run check:changes
```

A dependency change selects the full gate. If it fails, find the update responsible (bisect by
reverting packages), revert that one, record why, and run the gate again. Give up after three
rounds and report instead of pushing.

## 5. Commit

One commit, Conventional Commits with scope:

```
chore(deps): apply weekly dependency updates

Apply the compatible updates proposed in #<n>, #<n>, ...: <pkg> <old> → <new>, ...

<License sentence: which expressions and notice fingerprints matched; native-component keys
renamed and why no native code changed.>

Not applied: <pkg> <old> → <new> (incompatible), ...

Supersedes #<n>, #<n>, ...
```

End with the co-author line the session's attribution instructions give.

## Push

Push only when all hold:

- `npm run check:changes` passed on the exact commit being pushed.
- `licenses:check` passed and no stop condition was accepted.
- `origin/main` has not moved since the fetch (`git fetch origin` and compare). If it moved, rebase
  onto it, then run the gate again.

```bash
git push origin HEAD:main
```

If any condition fails, do not push. Keep the branch and worktree, and say so in the report.

After a successful push, remove the worktree and the temporary branch:

```bash
cd <repository root>
git worktree remove .claude/worktrees/deps-<yyyy-mm-dd>
git branch -D deps/<yyyy-mm-dd>
```

Dependabot closes the applied pull requests by itself. Leave the incompatible ones open: they are
the reminder list. Close a pull request by hand only when it is permanently unwanted, and add an
`ignore` rule to `.github/dependabot.yml` for it in the same change.

## Report

End with a short report in the maintainer's language:

1. **Applied** — packages and versions; the pushed commit SHA, or why nothing was pushed.
2. **Needs a decision** — license stop conditions, with what changed and the options.
3. **Not applied (incompatible)** — each with a one-line effort estimate.
4. **Capture layer** — affected crates and the reminder to run `smoke:capture` and `soak:capture`.

When there were no open Dependabot pull requests, say so in one line.

## Scheduled run

The weekly run is a Claude desktop scheduled task on the maintainer's Mac, Monday 09:00 local
time, with this repository as its folder and a prompt such as:

> Use the plvs-deps-update skill to handle this week's Dependabot pull requests.

A scheduled task runs only on the machine where it was created, while that machine is awake and the
Claude app is running. When moving to another machine, create the task there and delete the old one.
