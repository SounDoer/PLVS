# Update preferences and Dock controls implementation checkpoint

Date: 2026-10-16
Branch: `codex/update-preferences`
Status: In progress. Neither feature is ready to merge or publish.

## Implemented and exercised

- Vendored updater 2.13.2 with offline manifest reconstruction, cached signature verification, and
  verified installation entry point. Three standalone probe tests pass. The positive fixture was
  signed by the repository's Tauri CLI 2.12.1 with a disposable test key. Only its public key,
  signature, and non-executable payload are included. Changed bytes and a changed announced version
  fail verification. `requireSignedVersion` is enabled; the pinned CLI's `tauri build` embeds the
  app version in the signature's trusted comment automatically.
- Installation-scoped atomic cache, download lease, cancellation generation, corruption checks,
  and stale selection rejection. Three native cache tests pass.
- Native check/download/cancel/state commands with main-window/coordinator ownership, persisted
  automatic preference checks, opaque in-memory candidate IDs, and cancelable download futures.
  These commands are not yet connected to the frontend controller. There is no cached-install
  command or installation gate. Do not treat `installationSupported` as proof of completed U1.
- Fresh/existing preference initialization, dependency normalization, shared preference storage,
  and scheduled-check gating. Three native bootstrap tests cover fresh choice preservation,
  preexisting multi-instance data, and legacy data. Manual checking remains available with automatic
  checking disabled. Stale automatic responses are discarded. First-run and Settings UI remain TODO.
- Remote update preference changes notify settings subscribers without overwriting Workspace data.
  A focused backend test covers this. Workspace persistence strips the identity-wide preference.
- Dock vertical transport, toolbar toggle, and normal-window return action. Transport reuses the
  existing component and business callback; the duplicate toolbar pill is removed. The optional
  update action exists as a presentation prop but has no live controller connection yet.
- Candidate geometry is 72 CSS px wide and 136 CSS px minimum height. Agent Control screenshots
  were captured before/after, including live transport at minimum height. The optional update icon,
  long timecode, text-size variants, and macOS remain to validate. Returning Live no longer depends
  on an automatically opened toolbar.
- Portable Preset format v1 still accepts historical heights starting at 56 CSS px; applying a
  preset clamps its height to the current minimum. The portable canonical document is preserved,
  avoiding a gratuitous change to existing published artifact identities.

## Verification at this checkpoint

- Full Vitest run: 521 files, 5622 tests passed.
- Additional peer-preference test: all 15 backend tests passed after that full run.
- ESLint, frontend typecheck, and frontend formatting passed before the final backend synchronization
  addition; rerun the required gates before committing.
- Native library `cargo check --features dev-identity` passed.
- Native bootstrap tests: 3 passed. Cache tests: 3 passed. Vendored offline probe: 3 passed.
- A signed fixture is not an installer upgrade test. No stable installation was replaced.
- No implementation commit, push, installer publication, or merge has been made.

## Remaining critical path

1. Prove Windows installer destination/relaunch and a gate that survives old-process exit. The
   upstream Windows install method calls ShellExecuteW and exits; a lock held only by that process
   cannot cover replacement. Do not expose automatic downloading based on that method alone.
2. Validate real cached install/failure recovery in an isolated Windows installation; validate macOS
   replacement, read-only bundles, authorization cancellation, and recovery on a Mac.
3. Finish the shared frontend controller and Details ownership, safe ready-package reconciliation,
   bounded retry policy, and next-session eligibility. Preserve the displayed target while open.
4. Add first-launch choices and Settings switches, then connect cancellation to persisted preference
   changes. Review import/reset/export and Agent Control classification explicitly.
5. Add the Dock update accessory using the existing revisioned accessory protocol and shared Details
   body. Ensure restored Dock startup offers are visible without resizing the strip.
6. Finish user guide, privacy review, architecture/contract updates, complete native/screenshots
   verification, and required commit/push gates. Keep uncertain platform coverage explicit.

## Privacy source review for the implementation checkpoint

Reviewed `website/privacy/index.html`, `useUpdateCheck`, `updateCheck`, and the new native service.
The recipient remains GitHub Releases; no audio, diagnostics, or new user identifiers are added to
update requests. Staged payloads and manifests remain local to the installation-scoped cache. There
is no new upload or updater telemetry. Automatic request triggers now depend on persisted choices;
new settings UI and automatic-download wiring are still unfinished. Before publication, revise the
policy's unconditional startup-check wording and its incorrect claim that `latest.json` itself is
signed, and record the final download/storage/cancellation behavior and effective-date decision.
The policy and its effective date are not changed by this unpublished implementation checkpoint.
