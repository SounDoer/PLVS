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

It normally runs unattended every Monday morning as a local scheduled task (see
[Scheduled run](#scheduled-run)). The maintainer reads the report afterwards.

## Authority

The maintainer decided on 2026-10-30 that this skill may push its commit to `origin/main` without
asking, when every condition under [Push](#push) holds. That authority covers only the dependency
commit this skill produces. Anything outside the rules below is reported, not decided.

## 1. Prepare an isolated worktree

Other sessions may be working in the main checkout. Never apply updates there.

Before changing anything, inspect the checkout, linked worktrees, and open Dependabot proposals.
Acquire a repository-wide lease with an atomic `mkdir` at
`<absolute-git-common-dir>/plvs-deps-update.lock` (resolve the common directory with
`git rev-parse --path-format=absolute --git-common-dir`). Record the host, process/session, start
time, branch and worktree there. Hold it through push verification and cleanup. If it exists,
report the owner and stop; never delete another run's lease or bypass it. A maintainer must verify
an abandoned lease before removing it. Release only this run's lease when the run ends, including
on failure; keep failed branches and worktrees for investigation.

Choose a writable worktree location appropriate to the execution environment, outside the main
checkout; do not bind it to an agent-specific directory. Use a unique run ID including the date
and a random suffix, so a same-day retry cannot overwrite an earlier run. Inspect retained runs
and report them; do not reset, reuse or delete them automatically. The isolated branch/worktree
and its removal after a verified successful push are authorized by this skill.

```bash
git fetch origin
git worktree add <worktree-path> -b deps/<run-id> origin/main
cd <worktree-path>
npm run worktree:setup
```

The branch is temporary: the commit lands on main by pushing `HEAD:main`, and the worktree and
branch are removed at the end.

Use the Node version in `.nvmrc`. Check GitHub authentication and registry/network access before
installing. Before exiting for an empty proposal list, read the recorded backlog decisions and
check their reassessment conditions. If there are neither proposals nor authorized repository changes,
report any due decisions and release the lease without creating a worktree.

## 2. Collect and classify

```bash
gh pr list --author app/dependabot --state open --limit 1000 --json number,title,files,body,createdAt,url
```

Collect the complete inventory, paginating if necessary. A grouped pull request lists several
packages; classify each package separately, but count the pull request once for backlog reporting.

Read each update entry's current `open-pull-requests-limit` from `.github/dependabot.yml` (use
Dependabot's documented default when omitted). Report open version-update PRs and the limit for
each ecosystem/directory entry; distinguish security-update PRs, which have a separate limit. Do
not infer security status from a major/minor version bump; inspect the PR's metadata or update
details, and mark uncertain counts explicitly. Warn when an entry reaches 80% of its limit, has
only one slot left, or is full; at full capacity, new version-update proposals can be blocked.
For a limit of one, warn only when occupied. Never raise limits or close PRs merely to clear a
warning.

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
For `rust-toolchain`, edit `channel` in `rust-toolchain.toml`.

Tauri pairs move together: `tauri-plugin-<x>` with `@tauri-apps/plugin-<x>`, and `tauri` with
`@tauri-apps/api`, on the same major/minor release, or `tauri build` refuses to package. When one
side has no matching release yet, hold both. `scripts/tauriDependencyContract.test.js` enforces this.

Then confirm with a lockfile diff that
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

## 4. Commit

One commit, Conventional Commits with scope:

```
chore(deps): apply weekly dependency updates

Apply the compatible updates proposed in #<n>, #<n>, ...: <pkg> <old> → <new>, ...

<License sentence: which expressions and notice fingerprints matched; native-component keys
renamed and why no native code changed.>

Not applied: <pkg> <old> → <new> (incompatible), ...

Supersedes #<n>, #<n>, ...
```

End with the co-author line the session's attribution instructions give, if any; do not invent one.
If no applicable changes remain, do not create an empty commit.
Remove this run's clean worktree and temporary branch, release its lease, and report the skipped
packages. Do not run a full dependency gate when no dependency files changed.

## 5. Gate the final commit

After committing and allowing the pre-commit hook to finish, run:

```bash
npm run check:changes
```

A dependency change selects the full gate. If it fails, find the update responsible (bisect by
reverting packages), revert that one, record why, amend the dependency commit, and run the gate
again. Give up after three rounds and report instead of pushing. A passed gate remains valid only
while HEAD, the index and the worktree are unchanged; every amendment, rebase or generated-file
change requires a fresh gate before pushing. Do not modify unrelated product code to pass a gate.

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

After pushing, fetch and verify that the pushed SHA is on `origin/main` (equal to its tip, or an
ancestor if another session has since pushed). Inspect GitHub Actions for that exact SHA and wait
for the applicable push workflows to finish. Report every failure, timeout, or missing run as
unverified; a successful push alone is not a successful CI result. Do not force-push or automatically
revert a published commit. Keep the worktree and branch if verification fails or remains pending.

After verifying the push and its CI, remove only this run's clean worktree and temporary branch:

```bash
cd <repository root>
git worktree remove <worktree-path>
git branch -d deps/<run-id>
```

Dependabot closes the applied pull requests by itself. Leave unapplied pull requests open unless
the maintainer has authorized the specific disposition under [Backlog decisions](#backlog-decisions).

## Backlog decisions

Keep newly discovered incompatible updates and license/native-review stops as proposals. Present
the affected versions, reason, effort or review needed, and the options: schedule dedicated work,
defer until a stated date/condition, or reject a precisely scoped version range. Do not ask the
maintainer to approve each compatible update already covered by this skill's authority, or to
bypass a failed gate.

A proposal left open for 30 days is a candidate for long-term deferral, not permission to close it.
When capacity warnings occur, include the oldest unresolved proposals in the report even if they
are younger. Recommend a disposition; do not perform migrations, accept license stops, or create
or change tracking issues without the maintainer's authorization for that work.

After the maintainer approves a specific backlog plan:

- Find and reuse its tracking issue, or create one if authorized. Record ecosystem/directory,
  package and installed/proposed versions, PR links, the decision and its source/date, the exact
  deferred version range, and a reassessment date or concrete trigger. An agent-written summary
  alone is not evidence of maintainer approval; do not invent missing scope or an expiry.
- For an approved long-term deferral or rejection, prepare the narrow matching `ignore` rule in
  `.github/dependabot.yml`. Follow the repository's commit/check/push rules for this configuration
  change, within the maintainer's explicit authorization; the dependency-only push authority above
  does not cover it. Do not widen a version-specific decision into ignoring the whole package or
  all future major versions.
- Close only the approved PRs after the tracking issue exists and the matching ignore rule has
  landed on `origin/main` and passed CI. Link the issue and the configuration commit in the closure
  explanation. On any failure, keep the PR open and report the incomplete step. For grouped PRs,
  do not close a group while it still contains unapplied updates outside the approved disposition.

On every run, read the linked decision records as well as open proposals. Preserve existing
decisions and include their issue links in the report; do not ask for the same decision again while
its scope and reassessment condition remain unchanged. Reassess when its date/trigger is reached,
the proposal falls outside its approved range, or new security/license/native evidence changes the
basis of the decision. Report that change and request a new decision; do not silently remove or
extend ignore rules. Do not repeat an unchanged capacity warning as a new decision request.
Once a due decision has been reported, keep it pending without repeating the request unless new
evidence changes the options or urgency.

Keep decision records discoverable after PR closure: when creating an authorized tracking issue,
use a title starting with `Dependency deferral:`; put its issue URL in a YAML comment next to the
matching ignore rule. At the start of later runs, follow those links and search open and closed
tracking issues with that title prefix. Closing an issue alone does not revoke or extend its
recorded decision. Handle approved backlog configuration changes separately from the automatic
dependency commit, so their authorization and validation remain clear.

## Report

End with a short report in the maintainer's language:

1. **Applied** — packages and versions; the pushed commit SHA and CI result, or why nothing was
   pushed. Include retained branch/worktree paths when cleanup was not possible.
2. **Needs a decision** — license stop conditions, with what changed and the options.
3. **Not applied (incompatible)** — each with a one-line effort estimate.
4. **Capture layer** — affected crates and the reminder to run `smoke:capture` and `soak:capture`.
5. **Backlog** — open PRs / limit by update entry, capacity warnings, oldest long-lived proposals,
   and links to recorded decisions. Separate new or due decisions from unchanged deferred items.

When there are no open Dependabot pull requests and no recorded decisions due for reassessment,
say so in one line. Otherwise report due decisions even when ignored versions have no open PR.

## Scheduled run

The weekly run is a local scheduled task on the maintainer's always-on Mac, Monday 06:00
(Asia/Shanghai), with this repository as its folder. Read the latest skill on every run rather
than copying its procedure into the schedule. Use a prompt such as:

> Use $plvs-deps-update to handle this week's Dependabot pull requests. Follow the latest skill
> and repository instructions, acquire its repository-wide lease, and isolate dependency edits
> from the main checkout. Push only within the skill's authority after its final-commit gates
> pass, verify the pushed SHA and CI, and report the result in Chinese.

For a desktop scheduler, keep that machine awake, the scheduling application running, and the
repository available. Verify the scheduled execution environment can create its worktree, install
dependencies, run the gates, and authenticate to GitHub without interactive approval. A prose
authorization does not override sandbox/network restrictions. Test the prompt manually before
enabling the weekly run, then review the first scheduled results. Ensure only one scheduler owns
this weekly job; when moving it, disable the old schedule. An execution needing a decision stops
the affected package and reports it; it must not wait indefinitely for an unattended answer.
