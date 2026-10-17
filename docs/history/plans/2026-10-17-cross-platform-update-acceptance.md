# Cross-platform packaged update acceptance

Status: proposed

Design contract:
`../specs/2026-10-17-cross-platform-acceptance-design.md`.

## Purpose

Give Windows and macOS the same local, isolated acceptance contract for PLVS packaged updates. The
tool must prove that a real older package can discover, download, verify, retain, install, relaunch,
and restore a newer package without using the stable identity, stable data, production update feed,
or production signing key.

The existing Windows builder in `scripts/build-update-acceptance.mjs` is the behavioral baseline.
This work generalizes its safe parts and adds a macOS adapter; it does not turn acceptance packages
into Preview or release artifacts.

Update acceptance uses the shared verdicts, evidence envelope, exact-SHA rule, restoration contract,
and advisory release-reporting policy from the design contract. Missing evidence is reported
prominently but does not initially fail stable release preflight solely because it is absent.

## Safety invariants

- Archive one exact committed SHA. Apply all identity, version, endpoint, and key substitutions only
  inside an ignored artifact snapshot.
- Use an identity beginning with `com.soundoer.plvs.updatetest.` and a product name beginning with
  `PLVS Update Test`. Reject any other identity before building, serving, installing, or cleaning up.
- Generate an ephemeral Tauri updater signing key locally. Never print, publish, commit, or copy the
  private key into a delivery directory.
- Bind the feed to `127.0.0.1`, permit insecure HTTP only in the snapshot, and record every request.
- Use a platform-specific application-data directory and installation destination. Never read or
  mutate stable or Preview state.
- Require explicit, resolved paths for installation and cleanup. Cleanup may touch only paths
  recorded in the acceptance receipt and carrying the isolated identity.
- Production signing and notarization remain release verification concerns. Acceptance reports must
  state whether the macOS bundles are ad-hoc signed, test-certificate signed, or notarized.

## Shared acceptance contract

The same commands and receipt schema should be available on both platforms:

```text
npm run update:acceptance:build
npm run update:acceptance:serve -- artifacts/update-acceptance/<short-sha>
npm run update:acceptance:run -- artifacts/update-acceptance/<short-sha>
npm run update:acceptance:verify -- artifacts/update-acceptance/<short-sha>
```

`build` produces two real packages from the same source SHA: the repository version and the next
patch version. `serve` publishes the newer package through a loopback manifest. `run` drives the
installed older package through Agent Control where automation is safe and emits manual checkpoints
for native authorization UI. `verify` checks the evidence and fails when a required scenario is
missing.

The receipt should replace the Windows-only `artifacts` array with a versioned structure such as:

```json
{
  "schemaVersion": 2,
  "sourceSha": "<full sha>",
  "identity": "com.soundoer.plvs.updatetest.h<short sha>",
  "productName": "PLVS Update Test <short sha>",
  "feed": { "host": "127.0.0.1", "port": 18765 },
  "platform": { "os": "macos", "arch": "aarch64" },
  "versions": [
    { "version": "0.21.0", "package": "...", "signature": "...", "sha256": "..." },
    { "version": "0.21.1", "package": "...", "signature": "...", "sha256": "..." }
  ],
  "signing": { "updater": "ephemeral-minisign", "bundle": "ad-hoc" },
  "substitutions": [],
  "warning": "Isolated acceptance packages; do not publish."
}
```

The platform key in `latest.json` must be derived from the built target rather than hard-coded:
`windows-x86_64`, `darwin-aarch64`, or `darwin-x86_64`.

## Architecture

### 1. Shared snapshot and receipt library

Extract the platform-neutral work from `scripts/build-update-acceptance.mjs` into a small library:

- resolve and archive HEAD;
- create and validate the isolated identity and artifact root;
- link `node_modules` without copying it;
- generate the ephemeral updater key;
- patch package, Cargo, Tauri, CSP, identity, version, and loopback updater configuration in the
  snapshot;
- hash packages, collect signatures, and write the receipt atomically;
- reject a dirty or mismatched snapshot instead of silently reusing it.

Keep platform build commands behind explicit adapters. The library must not guess that a Windows
installer and a macOS app archive have the same install semantics.

### 2. Preserve Windows behavior

Move the existing NSIS build into the Windows adapter without changing its installed registry
namespace, two-version package shape, or offline cached-update workflow. A contract test should
compare the new receipt and feed with the current Windows expectations before adding macOS.

### 3. Add the macOS builder

The macOS adapter should:

- build the CLI and app for the current Mac architecture from the snapshot;
- generate a real `.app`, DMG, and updater `.app.tar.gz` for each version;
- sign the updater payload with the ephemeral Tauri key and record its `.sig`;
- ad-hoc sign every nested executable and the final app bundle when no named test certificate is
  supplied, then verify with `codesign --verify --deep --strict`;
- optionally accept an explicitly named local test certificate through an environment variable,
  without storing that identity in the receipt or repository;
- use a product name and bundle identifier that cannot collide with stable, dev, or Preview;
- stage the older app in an isolated writable directory whose path contains spaces.

The first implementation should support the host architecture. Universal or cross-architecture
artifacts are a later extension and must not be implied by the receipt.

### 4. Generalize the local feed

Update `scripts/serve-update-acceptance.mjs` to read schema version 2, select the exact host platform,
serve the matching package and signature, and keep `requests.jsonl`. Add deterministic switches for:

- valid manifest and package;
- stale or wrong signature;
- wrong signed version;
- truncated package;
- manifest unavailable after a package has been staged.

Each fault mode must be visible in the request log and acceptance evidence.

### 5. Add a platform-neutral runner

Use the packaged `plvs-cli` and Agent Control rather than reaching into stores. The runner should:

1. install or copy the older isolated package;
2. launch it and record application version, identity, workspaces, settings, Dock state, and update
   preferences;
3. prove that the feed is untouched before the user enables automatic download;
4. enable download through the normal UI/business path and wait for a verified ready package;
5. stop the feed and prove the cached offer survives restart;
6. exercise Skip, reopen from the Dock accessory, and explicit offline installation;
7. wait for relaunch and prove the executable, CLI, and app version changed to the newer version;
8. compare workspace IDs, settings, Dock layout, and serialized persistence before and after;
9. prove that ready state was cleared and the helper attempt finished without an error;
10. capture update-details and restored-Dock screenshots plus structured JSON evidence.

The runner must restore or remove only its isolated application and data when it finishes.

## macOS-specific acceptance matrix

| Scenario                               | Required evidence                                                 | Automation boundary                        |
| -------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| Writable install path with spaces      | Offline replacement, relaunch, version/CLI change, state equality | Fully automated                            |
| APFS bundle swap                       | Old/new bundle identities and helper `finished` record            | Fully automated                            |
| Stale signature                        | No ready package retained; visible error                          | Fully automated                            |
| Corrupt/truncated package              | Verification failure before native replacement                    | Fully automated                            |
| Feed unavailable after staging         | Cached offer and offline install still work                       | Fully automated                            |
| Two open workbenches                   | Both restore with the same workspace IDs                          | Fully automated                            |
| Docked startup                         | Edge, height, panels, and update accessory restore                | Fully automated                            |
| Helper interruption before replacement | Old app relaunches; staged package and error remain actionable    | Automated fault fixture                    |
| Replacement failure after backup       | Old bundle restored; backup disposition recorded                  | Automated fixture plus existing Rust tests |
| App launched from read-only DMG        | Automatic install refused with “move to Applications” guidance    | Fully automated                            |
| Privileged `/Applications` replacement | Authorization prompt, successful replacement, relaunch            | Manual authorization checkpoint            |
| Authorization cancellation             | Old app remains runnable; attempt/error state is coherent         | Manual cancellation checkpoint             |
| Gatekeeper/notarization                | `codesign`, `stapler`, and `spctl` pass                           | Release candidate only                     |

The writable-path run is the routine developer acceptance gate. Privileged replacement and
notarization remain explicit release evidence; the tool must report them as `manual` or `notRun`,
never silently treat supporting unit tests as a pass.

## Evidence

Write each run below `artifacts/update-acceptance/<short-sha>/runs/<run-id>/`:

- `result.json` with per-scenario `passed`, `failed`, `manual`, or `notRun` status;
- `before.json` and `after.json` Agent Control snapshots;
- `helper-attempt.json` and sanitized application logs;
- `requests.jsonl` copied from the feed;
- update-details and restored-Dock PNGs;
- package SHA-256 values and public signatures;
- cleanup result proving that no isolated processes, mounts, or Dock reservations remain.

`verify` should require all routine automated scenarios, validate artifact hashes, confirm the
source SHA and identity, and print the manual/release-only gaps separately.

## Tests and repository integration

- Add Vitest contract tests for snapshot isolation, receipt validation, platform-key selection,
  loopback-only serving, fault modes, and cleanup path guards.
- Extend release workflow contract tests so production packages can never use the acceptance
  identity, endpoint, or key.
- Add focused Rust fixtures only where deterministic failure injection cannot be achieved outside
  the updater; keep native bundle swap/rollback tests in the vendored updater crate.
- Add package scripts only after both adapters implement the same command contract.
- Document operator commands in `CONTRIBUTING.md` when the workflow is usable. Keep run-specific
  findings in a new history note rather than editing the older Windows acceptance record.
- Do not add this GUI/package workflow to ordinary CI. CI should run its contract tests; a real Mac
  or Windows host runs packaged acceptance before a stable release.

## Implementation order

1. Define and test schema version 2, shared safety guards, platform detection, and feed generation.
2. Refactor the Windows builder/runner onto the shared contract and repeat its current acceptance
   run to prove no regression.
3. Implement the macOS host-architecture builder and writable-path runner.
4. Add feed fault modes, read-only DMG verification, and deterministic helper failure fixtures.
5. Add manual privileged-install/cancellation checkpoints and release-candidate signing evidence.
6. Wire the verifier into stable release review as an advisory freshness/evidence check, not as an
   attempt to perform GUI authorization inside CI. It must print missing or incomplete Windows and
   macOS evidence prominently without initially failing the release solely for that absence.

## Definition of done

- One command contract builds, serves, runs, and verifies isolated acceptance on Windows and macOS.
- Both platforms prove a real offline cached upgrade between two real packages from the same SHA.
- Both produce the same versioned evidence schema and comparable scenario names.
- macOS additionally proves writable bundle swap, read-only-DMG refusal, bundle rollback behavior,
  Dock restoration, and clearly reported authorization/notarization boundaries.
- Stable, dev, and Preview identities, data, installations, feeds, and keys are untouched.
- The private updater key is absent from Git, logs, screenshots, and manual-delivery artifacts.
- Contract tests fail if any safety invariant or required evidence field is removed.
