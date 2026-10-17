# Agent Control acceptance evidence implementation plan

**Date:** 2026-10-18

**Design:** `docs/history/specs/2026-10-18-agent-control-acceptance-evidence-design.md`

## 1. Extend the report contract

- Add `agent-control` to the known acceptance domains.
- Keep stable platform ordering and the existing Linux opt-in behavior.
- Update matrix and Markdown tests to expect the fourth domain without changing advisory-gap or
  target-SHA failure semantics.

## 2. Upgrade the desktop smoke producer

- Resolve a clean source SHA before starting a formal smoke.
- Track the six deterministic smoke scenarios as each real operation completes.
- Preserve the compatibility `smoke-report.json` on success.
- Write a shared `result.json` on success and on caught product/cleanup failure.
- Record artifact hashes and cleanup observations without changing UI ownership or instance pinning.
- Preserve the current nonzero exit behavior by rethrowing the original failure after evidence is
  safely written.

## 3. Cover orchestration and failure evidence

- Test a complete run, a mid-run screenshot failure and cleanup success/failure.
- Assert that omitted scenarios become `notRun`, failures cannot be labelled complete, and both
  report files retain their intended contracts.
- Keep argument, artifact and unsafe-start coverage intact.

## 4. Document and verify the real workflow

- Add Agent Control evidence to the explicit `acceptance:report` example and explain the two report
  files in `CONTRIBUTING.md`.
- Run focused tests, `npm test`, formatting, lint and typecheck.
- Commit the implementation, start the current dev app, run the real macOS smoke and generate a
  shared report containing that exact-SHA evidence.
- Stop the dev app and verify that no owned UI surface or recording remains.
