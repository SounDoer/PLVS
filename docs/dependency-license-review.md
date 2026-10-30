# Dependency license review

This is the maintainer review process for dependency and native-component license changes. The
automated check is an omission guard, not legal advice. General dependency-update and CI conventions
remain in [CONTRIBUTING.md](../CONTRIBUTING.md).

`npm run licenses:check` checks the current lockfiles against reviewed component notices and native
inputs. It runs in CI and in the full repository gate. It is an engineering control, not an automatic
legal opinion. Do not accept a changed license merely to make the check green.

When updating dependencies:

1. Run `node scripts/generate-component-notices.mjs --candidate` and inspect the proposed record.
   This command only prints a candidate; it never accepts a review or changes the committed policy.
2. Review every added/changed component's original license, copyright statements, nested notices,
   and any source-distribution obligations. Preserve `AND` requirements; an `OR` permits a choice.
   The candidate's `noticeSha256: null` means upstream materials are missing, not approved.
3. Record reviewed entries in `licenses/component-sources.json`. For missing upstream files,
   retrieve the exact package's VCS revision (Cargo `.cargo_vcs_info.json` or npm `gitHead`), retain
   the bytes under `licenses/upstream/`, and record URL and SHA-256. Some packages declare their
   license only in metadata or source headers: preserve those verbatim via `localFiles`, explain
   the exception, and include the standard terms. Never invent an upstream copyright statement.
4. Review `licenses/native-components.json` whenever a native binding, model, feature set, sidecar,
   toolchain, or registered input changes. Inspect embedded native code and downloads performed by
   build scripts, not just Cargo/npm license fields. New execution providers need a fresh review.
5. Run `npm run licenses:generate`, then `npm run licenses:check` and the scope-appropriate tests.
   Generation cannot automatically approve new versions or changed license contents.
6. Before publishing, run `npm run licenses:sources`. It downloads the offered corresponding-source
   archives and verifies their hashes; an unavailable or replaced source archive blocks publication.
   Final package checks compare the entire license payload with the reviewed repository bytes.

Development tools used only to build/test are not automatically redistributed with their outputs.
Review generated or embedded code separately: Tailwind CSS is explicitly included in the shipped
notice collection; ONNX Runtime is separately recorded despite being fetched by a build script.
Changing a tool's license, redistributing a development environment, or adding generated runtime
code requires review of that use. Source-code license compliance does not settle codec patents.

Do not infer a model's license from its Rust wrapper. In particular, historical `ten-vad-rs`
metadata says Apache-2.0 while the upstream TEN VAD model adds usage restrictions. It is recorded
in `restrictedPackages`; generation cannot approve its reintroduction. Any future use needs an
explicit review of the actual model terms, not just a refreshed package record.

For historical releases, prepare supplements against each release's exact lockfiles and binary
provenance. Never apply today's dependency list to an old installer, overwrite an existing binary,
or claim unavailable historical provenance has been verified. Additional release attachments must
identify their scope and remaining limitations.

## Unattended weekly updates

The `plvs-deps-update` skill (`.agents/skills/plvs-deps-update/`) applies Dependabot's proposals
without a maintainer reading each notice. It may record a change on its own only when every added
entry in the candidate satisfies one of these:

- **Runtime component, new version of a recorded package:** the previous version's `license`
  expression and `noticeSha256` are identical, so the shipped notice text is unchanged.
- **Runtime component, new package:** `noticeSha256` is not `null`, and the expression uses only
  MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Zlib, Unlicense or CC0-1.0.
- **Tool:** the previous version of the same package has an identical license expression, or a new
  package uses only the licenses listed above.
- **Native component:** the previous version's key is renamed only after comparing the two
  published sources and finding no added or changed build script, native source, bundled binary,
  model or download.

Everything else stops that package at its current version and goes to a maintainer: a changed
expression, a copyleft or non-commercial license, `UNKNOWN`, a `null` notice, a hit in
`restrictedPackages`, or any new native code or download.
