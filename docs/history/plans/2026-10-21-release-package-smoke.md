# Release-package smoke plan

Spec: `docs/history/specs/2026-10-21-release-package-smoke-design.md`.

1. ADR 0035 and the product change: drop the build gate on `--plvs-test-app-data-root` (lib.rs) and
   `PLVS_TEST_IDENTITY_ROOT` (cli_control.rs, cli_main.rs). Verify: `rust:check`, Rust tests.
2. `scripts/release-package-smoke.mjs` reusing `runAgentControlSmoke` (new `env` option) and the
   capture-rig helpers; `scripts/verify-release-package-evidence.mjs`. Verify: unit tests for the pure helpers and the verifier.
3. `.github/workflows/release-package-smoke.yml` (dispatch + call), called from `release.yml`;
   `prepare-draft` needs it. Verify: release and self-hosted contract tests.
4. Remove the local `smoke:agent-control` run from `run-release-gate.mjs` (and the now unused
   `agent-control-code-changed.mjs`), the skill's manual GUI step; update CONTRIBUTING, AGENTS.md,
   the CLI guide. Verify: `npm test`.
5. Local Windows run against a locally built stable portable package while the maintainer's
   installed PLVS runs. Verify: complete evidence, the installed app's profile untouched.
6. With the user's approval, push and dispatch the workflow on the real runners against a release
   run's candidates. Done when Windows and macOS pass and Linux passes or is blocked only on the
   documented setup.
