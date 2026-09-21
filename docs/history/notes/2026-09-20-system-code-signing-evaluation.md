# System Code Signing Evaluation

Date: 2026-09-20

## Scope

Initial evaluation of system-level code signing for official PLVS releases. This record captures the
starting position only. Later decisions and implementation plans belong in new history records.

## Initial Direction

- macOS: join the Apple Developer Program, sign with Developer ID Application, notarize the final
  distribution, staple the notarization ticket, and verify codesign and Gatekeeper acceptance.
- Windows: apply to SignPath Foundation for free open-source Authenticode signing first. Consider a
  paid OV code-signing service only if PLVS is ineligible or the SignPath operating model is not
  acceptable.
- Keep Tauri updater signatures. They authenticate updater payload bytes and do not replace Windows
  Authenticode or Apple Developer ID signing.
- Preserve the existing exact-SHA, build-once, test-the-release-candidate, immutable-publication
  model. System signing and notarization are release-candidate transformations; smoke tests must run
  against the final signed artifacts that will be published.

## Critical Ordering Constraint

Authenticode signing and macOS stapling change artifact bytes. A Tauri updater signature created
before those transformations would no longer match. The release pipeline must finish all
system-level signing and final packaging before it creates or regenerates the Tauri updater payload
signature.

## Windows Findings to Refine

- A SignPath Foundation certificate identifies the publisher as SignPath Foundation, not PLVS or
  SounDoer.
- SignPath keeps the certificate private key in its signing infrastructure and verifies that signing
  requests originate from the configured GitHub Actions workflow.
- The free open-source program requires an OSI-approved license, public project documentation,
  repository control, MFA, declared project roles, a privacy statement, a code-signing policy, and
  manual approval for release signing.
- PLVS-owned executables and the installer should receive Authenticode signatures. Bundled upstream
  executables such as FFmpeg and ffprobe must not be represented as PLVS-owned binaries.
- The Windows pipeline may need separate signing stages for PLVS executables and the final NSIS
  installer so the installer embeds the signed executables. This must be proven with a SignPath
  artifact-configuration prototype before implementation is finalized.

## Open Decisions

- Whether the Windows publisher display name `SignPath Foundation` is acceptable.
- Whether SignPath accepts PLVS under its current project-reputation and team-role requirements.
- The exact SignPath artifact configuration and number of approvals required per release.
- The paid Windows fallback provider and cloud/HSM signing model, if needed.
- Whether Apple enrollment should use an individual or organization legal identity.

