# Windows Code-Signing Options

Date: 2026-09-20

## Current Preference

Apply to SignPath Foundation first. Its free OSS program fits PLVS's current public, MIT-licensed,
GitHub-hosted release model, provided that the project is accepted and the Windows publisher name
`SignPath Foundation` is acceptable.

Preparation for an application includes GitHub and SignPath MFA, a public code-signing policy,
declared author/reviewer/approver roles, a privacy-policy reference, and a clear boundary between
PLVS-owned executables and bundled upstream FFmpeg binaries.

## Alternatives

- A paid public-trust code-signing service is the primary fallback for direct GitHub downloads. Use
  an individual-validation product if there is no eligible legal organization, or an
  organization-validation product after a legal entity exists. Prefer cloud/HSM signing that works
  with GitHub-hosted runners over a physical USB token.
- Microsoft Artifact Signing is technically attractive but its current Public Trust geographic
  eligibility does not cover an individual or organization based in mainland China.
- Microsoft Store distribution can provide Microsoft-signed MSIX packages without a separately
  purchased public certificate. It would be an additional distribution channel, not a signature
  for the existing GitHub-hosted NSIS installer or portable ZIP.
- Self-signed certificates and non-Authenticode signatures do not solve public Windows trust and
  are not release alternatives.

## Decision Status

No provider has been selected or applied to yet. The next Windows step is to prepare and submit a
SignPath Foundation application before changing the release workflow.

