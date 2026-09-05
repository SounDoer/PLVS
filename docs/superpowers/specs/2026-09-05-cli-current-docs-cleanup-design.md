# CLI Current Documentation Cleanup

Date: 2026-09-05
Status: Approved

## Problem

Several current documentation surfaces still describe the removed standalone CLI, claim the
installer adds PATH unconditionally, or describe Windows Portable as one executable. AGENTS also
directs capture-rig operators to the removed `devices` command and documents only the old harness
freshness check.

## Design

- Landing docs: state that enabling Agent Control adds the CLI directory to PATH; Portable users
  invoke the sibling forwarder from the extracted folder.
- CONTRIBUTING: keep the dev-identity explanation, state that Release CLI does expose `app`, and
  describe raw `plvs.exe` / `plvs-cli.exe` outputs plus Release ZIP staging.
- AGENTS: replace `plvs-cli devices` with Doctor's `device-enumeration` check, describe capture
  preflight dependencies, and record both harness feature and freshness validation.

Do not edit historical plans or changelog entries that accurately describe old releases.

## Tests

Add one current-documentation contract test that rejects the stale phrases and requires their
replacement concepts in README, landing docs, CONTRIBUTING, and AGENTS.
