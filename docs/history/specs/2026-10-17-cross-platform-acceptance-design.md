# Cross-platform Acceptance Design

**Date:** 2026-10-17

**Status:** Accepted

**Scope:** Repository-owned packaged update, live capture, native Dock, desktop performance, and
package verification tooling for Windows and macOS

## Summary

PLVS will use one acceptance model across Windows and macOS without pretending that the two
operating systems have the same native mechanisms. Each acceptance domain defines shared scenarios,
verdicts, evidence, restoration rules, and user-visible meaning. Platform adapters perform the
native work.

Acceptance complements unit, component, integration, and release-signing tests. It proves behavior
through a real application, package, device, window manager, or long-running process when ordinary
tests cannot reach that boundary.

Missing or stale cross-platform acceptance evidence will not block a stable release initially. It
must be reported prominently and specifically in release review; it may never be silently omitted
or represented as a pass. Promoting a domain from advisory evidence to a blocking gate requires a
later explicit decision based on reliable runs on both platforms.

## Goals

1. Give Windows and macOS the same scenario names and product-level pass criteria.
2. Keep native setup, execution, and cleanup in explicit platform adapters.
3. Bind every acceptance result to one exact Git SHA, platform, architecture, and tool version.
4. Distinguish product failures, unusable test rigs, manual checkpoints, and unrun scenarios.
5. Produce comparable structured evidence without requiring identical operating-system internals.
6. Protect stable, dev, and Preview identities, installations, data, devices, and signing material.
7. Restore every test-owned mutation and prove cleanup before declaring a run complete.
8. Surface missing or stale evidence during release review even while evidence remains advisory.

## Non-goals

- One universal runner containing updater, audio, Dock, performance, and package logic.
- Making GUI authorization, hardware access, notarization, or long-running soaks ordinary CI jobs.
- Treating a supporting unit test as evidence that a real packaged or native scenario passed.
- Requiring Windows and macOS to use the same device driver, webview protocol, installer, or window
  manager API.
- Adding test-only behavior to stable or Preview product identities.
- Publishing acceptance packages or private signing material.
- Claiming Intel macOS coverage while PLVS release artifacts and acceptance runs are Apple Silicon
  only.

## Test layers

The repository uses four distinct layers. Reports and release reviews must name the layer rather
than using “tested” without qualification.

1. **Code tests** exercise functions, components, contracts, and deterministic native units.
2. **Application smoke** drives a running dev app through supported interfaces and checks a bounded
   happy path.
3. **Acceptance** uses a real packaged app, native integration, hardware rig, or operating-system
   boundary and preserves structured evidence.
4. **Release verification** checks production signing, notarization, final assets, and publication
   inputs for an exact candidate SHA.

A lower layer supports but does not replace a higher one. For example, macOS bundle rollback unit
tests do not prove that a signed packaged app upgraded successfully, and a packaged acceptance app
with ad-hoc signing does not prove notarization.

## Shared acceptance model

Each domain owns an independent command family and runner. Shared libraries may provide receipt
validation, exact-SHA checks, platform naming, safe artifact paths, process cleanup, hashing, and
report formatting.

The conceptual flow is:

```text
scenario contract
       |
       +-- Windows adapter -> native execution --+
       |                                          |
       +-- macOS adapter  -> native execution ----+-> common evidence and verdicts
```

The shared layer must not contain platform-specific device names, installer commands, authorization
scripts, process termination commands, or window-manager assumptions.

## Scenario contract

Every acceptance domain defines:

- the product behavior being proved;
- prerequisites and a machine-readable rig diagnosis;
- deterministic inputs or a recorded candidate artifact;
- shared scenario IDs and required observations;
- platform-specific setup and native actions;
- expected restoration and cleanup;
- evidence retention and sensitive-data exclusions;
- which scenarios are automated, manual, release-only, or unsupported;
- the distinction between a product failure and a rig failure.

Scenario IDs remain stable when the user-visible claim remains the same. Platform adapters may add
native evidence but must not silently weaken a shared scenario.

## Verdicts

Every scenario has exactly one status:

- `passed`: all required observations were collected and satisfied;
- `failed`: the product or acceptance implementation violated the scenario contract;
- `rigUnavailable`: a declared prerequisite was missing or unusable, so no product verdict exists;
- `manual`: the scenario reached a documented human checkpoint and records whether that checkpoint
  was completed;
- `notRun`: the scenario was intentionally not attempted, with a reason;
- `unsupported`: the product or current acceptance adapter does not claim the scenario on this
  platform or architecture.

`manual`, `notRun`, `unsupported`, and `rigUnavailable` are never rendered as green passes. A suite
summary is `complete` only when every required automated scenario passed and every required manual
checkpoint was completed. It may otherwise be `incomplete`, `failed`, or `unavailable`.

## Evidence envelope

Domain reports share an envelope while retaining domain-specific observations:

```json
{
  "schemaVersion": 1,
  "domain": "update",
  "runId": "<opaque id>",
  "sourceSha": "<full git sha>",
  "platform": { "os": "macos", "arch": "aarch64", "version": "<os version>" },
  "tool": { "name": "update-acceptance", "version": 1 },
  "startedAt": "<timestamp>",
  "endedAt": "<timestamp>",
  "summary": "complete",
  "scenarios": [],
  "artifacts": [],
  "cleanup": { "status": "passed", "observations": [] },
  "warnings": []
}
```

Every referenced artifact records a relative path, media type, byte count, and SHA-256. Reports use
relative paths so an artifact directory can move as one unit. Logs and snapshots must omit private
keys, passwords, tokens, unrelated user data, and raw environment dumps.

Full evidence lives under ignored `artifacts/` during development or in a bounded-lifetime release
candidate artifact. The repository stores schemas, contracts, fixtures, and tooling, not generated
packages, private keys, or large run output.

## Exact source and isolation

- An acceptance build archives one committed SHA. Snapshot substitutions occur only inside the
  ignored artifact directory.
- Test identities must be syntactically and visibly separate from stable, dev, and Preview.
- Data roots, IPC endpoints, update feeds, installation paths, registry namespaces, and bundle IDs
  must be isolated by the test identity.
- A runner refuses cleanup unless the resolved target is inside its recorded artifact/data root or
  carries its exact isolated identity.
- Reusing an artifact directory requires matching source SHA, schema, platform, architecture, and
  substitutions. A mismatch fails instead of silently rebuilding part of a run.

## Platform and architecture claims

Windows and macOS reports are separate evidence for the same shared scenarios. One platform's pass
never fills the other platform's row.

The first macOS acceptance adapters target Apple Silicon `aarch64`, matching the current release
artifact. Intel or Universal coverage requires a real matching build and run; it cannot be inferred
from source compatibility.

## Native authorization and signing

Routine automated acceptance uses disposable, writable locations and must not store or inject an
administrator password. Native authorization approval and cancellation are explicit manual
checkpoints.

Updater payload signatures may use a locally generated ephemeral test key. macOS acceptance bundles
may use ad-hoc signing or an explicitly selected local test certificate. Those results prove update
integrity and bundle replacement only. Gatekeeper, Developer ID, stapling, and notarization remain
release verification and require the final candidate.

## Hardware and exclusive rigs

Hardware-backed acceptance declares its physical or virtual prerequisites and uses the repository's
cross-worktree lease mechanism. A busy live lease waits when requested or reports `rigUnavailable`;
it is never bypassed.

The macOS capture adapter should first attempt a deterministic native system-output route. If that
cannot provide repeatable channel identity and level, the acceptance machine may install a dedicated
virtual audio device. That dependency belongs to the test rig, not the PLVS product, installer, or
user documentation.

Before choosing the macOS audio route, a spike must prove:

- deterministic left/right signal delivery;
- stable device discovery after restart;
- sample rate and channel layout control;
- no contamination from notification or microphone audio;
- reliable teardown and restoration of the user's previous output device;
- compatibility with unattended smoke and long-running soak execution.

## Restoration and cleanup

Runners record their initial state before the first mutation and restore through supported product
or operating-system paths. Cleanup is part of the verdict, not best-effort decoration.

Each run checks for domain-relevant leftovers, including:

- owned app and helper processes;
- mounted images and local feed servers;
- update gates, ready packages, leases, and temporary identities;
- Dock/AppBar or macOS work-area reservations;
- changed output devices and test-tone players;
- temporary app-data, installation, and webview data directories.

If restoration ownership cannot be proven, the runner stops and reports the exact manual action
needed rather than overwriting external changes.

## Release reporting policy

Cross-platform acceptance is initially advisory. Release tooling must still evaluate evidence for
the exact candidate SHA and print a prominent acceptance section containing:

- each applicable domain and platform;
- evidence SHA and age;
- suite summary and failed scenarios;
- missing, stale, `notRun`, `manual`, `unsupported`, and `rigUnavailable` scenarios;
- a clear statement that release is proceeding without complete acceptance evidence when applicable.

The initial policy does not return a failing release-gate exit code solely because evidence is
missing or incomplete. Product failures discovered by a run remain real failures and should be
fixed; the advisory policy is not permission to label them passed.

Moving any domain to a blocking release gate requires explicit approval and evidence that both
platform adapters are reliable enough that rig failures are distinguishable from product failures.
Long-running soaks remain diagnostic unless separately approved as gates.

## Domain rollout order

1. **Packaged update:** generalize the existing Windows two-version acceptance and add macOS bundle
   replacement, offline install, rollback, read-only DMG, and manual authorization checkpoints.
2. **Live capture:** share signal, metrics, lease, drift, and evidence contracts; add a proven macOS
   audio route beside the Windows VB-Cable adapter.
3. **Native Dock:** share top/bottom, reservation, measured height, multi-instance, restart, and
   cleanup scenarios; keep Windows AppBar and macOS work-area implementations separate.
4. **Desktop performance:** share backpressure, frame/audio drop, recovery, and soak verdicts after a
   macOS WKWebView observability spike.
5. **Package verification:** retain NSIS/Portable and DMG/native security checks while unifying their
   command shape and evidence envelope.

File analysis, Agent Control visual capture, UI walkthrough, loudness reference, and website checks
already have platform-neutral or explicit dual-platform coverage. They may adopt the evidence
envelope later, but they do not require new platform adapters in this rollout.

## Consequences

- Acceptance results become comparable without hiding platform differences.
- Release reviews gain visible evidence gaps before those gaps are promoted to hard gates.
- Adding a new platform requires an adapter and real evidence, not a renamed Windows result.
- Tooling remains domain-sized instead of becoming one fragile orchestration program.
- macOS capture and performance work begin with measurement spikes, preventing plans from assuming
  unavailable native capabilities.
- Advisory evidence can initially be incomplete, so release summaries must remain explicit until a
  later decision makes selected domains blocking.
