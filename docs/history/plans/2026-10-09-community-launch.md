# Community Launch Completion

Date: 2026-10-09

Scope: complete the official curated launch in an isolated worktree. Publication is a separate
release action. Public submissions and accounts remain deferred.

- [x] Unify website and content deployment under live immutable-history validation and a shared lock.
- [x] Cover content-only publication followed by an outdated desktop-site publication.
- [x] Regenerate and review the three official Items with the current renderer.
- [x] Restore the manifest and reconcile launch documentation and dates.
- [x] Verify the assembled website and Windows portable imports, including duplicate/draft protections.
- [x] Run the full repository gate; record platform-specific acceptance still requiring evidence.

The live site has no publication marker and an empty Catalogue at the start of this work. Bootstrap
is restricted to that legacy empty state, using the immutable v0.19.0 commit. Once content exists,
a missing or invalid marker blocks deployment instead of treating it as a new empty Catalogue.
Bootstrap is an explicit first-publication input, disabled by default, even when the marker returns
404. This prevents a later missing marker from silently treating a fully withdrawn Catalogue as a
new empty history.

## Qualification

- All three canonical files pass source validation with the real manifest restored.
- Thirteen previews were regenerated and visually reviewed. The current default Polar Level
  Vectorscope exposed a missing pair-history fixture; the isolated renderer now supplies deterministic
  stereo samples to both polar modes. The production panel and audio engine are unchanged.
- The complete local website passes browser checks for three downloads (byte-for-byte agreement
  with canonical files), search/no-results/reset, Copy Theme, all three mobile detail pages without
  horizontal overflow, image loading, and navigation/downloads with JavaScript disabled.
- The redesigned homepage had lost its Community markers. Navigation and footer links are restored,
  guarded by tests assembling the real homepage and docs templates with empty and populated content.
- The website's old Import Shared Item instruction now points to Saved Items → Import….
- Windows verification used a freshly built matching development host/CLI and a disposable app-data
  root. Each Item passed dry-run import, actual import, duplicate no-op import and explicit application.
  Import preserved the initial Theme selection. An open Theme editor blocked Preset application with
  `editorActive` and unchanged revision; duplicate import preserved the open editor. Screenshots before
  and after application were captured through Agent Control. The owned process was stopped afterward.
- Actionlint 1.7.12 accepts all three changed deployment workflows.
- `npm run check` passed: version, attribution, Catalogue source, formatting, lint, typecheck,
  all 5,213 frontend/tooling tests in 479 files, production build, Rust format, Clippy and Rust tests.

Local evidence is under `artifacts/community-launch/`: `site-report.json`,
`desktop/report.json`, preview images, website screenshots, and the full gate log. Earlier failed
runs diagnosed an outdated native host identity, a verification-script surface-ID typo, and copied
website test files in the local output; the final verification uses corrected tooling. The initial
full-suite timeout passed on isolated rerun and on the subsequent complete suite without relaxation.
An additional pre-commit full-suite run concurrent with Rust compilation reproduced a Git-test
timeout; the final pre-commit run passed all 5,213 tests with two workers and normal timeouts.

## Remaining release acceptance

- Run the same download/import/apply review on macOS. This Windows task has no remote shell for the
  connected Mac; shared validators and browser tests are not a substitute for that native check.
- The Windows check exercised real running business functions through Agent Control, not the native
  file picker or keyboard paste gesture. Retain those user-facing gesture checks in release acceptance.
- Confirm Listing dates against the actual publication day before freezing the release commit.
- Merge and publish through the normal official release process. First website publication needs
  the documented `bootstrap_community` input; subsequent publications leave it off.
- Verify the live marker, entry links, downloads and previews after deployment. No public deployment
  was performed during this implementation.
