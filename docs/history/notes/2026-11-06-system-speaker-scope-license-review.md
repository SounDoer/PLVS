# System Speaker Scope: Windows Feature Review

Date: 2026-11-06

The speaker-scope implementation explicitly enables `Win32_UI_Shell_PropertiesSystem` on the
existing `windows` 0.62.2 dependency to read the endpoint's configured speaker property.

Review evidence:

- The complete Cargo manifest diff adds only that feature. `Cargo.lock` is unchanged from the
  preceding `fe519386` implementation commit: no package, version, source or checksum changed.
- CPAL 0.18.2 already enables `Win32_UI_Shell_PropertiesSystem` and
  `Win32_System_Com_StructuredStorage` on its existing `windows` 0.62 dependency. The explicit PLVS
  declaration therefore does not add a previously disabled Windows binding module to this graph.
- The API calls open the existing endpoint property store read-only, read
  `PKEY_AudioEndpoint_PhysicalSpeakers`, convert its property value and release the value. The
  conversion/cleanup declarations link the operating system's `propsys.dll`; no binary is bundled.
- The changed feature is generated Windows API binding code under the already reviewed `windows`
  package. It adds no native source compilation, build-script download, execution provider, model,
  sidecar or redistributed runtime component. Existing license expressions and notice bytes remain
  applicable; no license terms or source-distribution obligations changed.

Refresh only the registered Cargo manifest digest in `licenses/native-components.json` after this
review. Regenerate and verify the standard notice outputs; do not replace or waive any reviewed
component entry. Platform behavior still requires separate native acceptance.
