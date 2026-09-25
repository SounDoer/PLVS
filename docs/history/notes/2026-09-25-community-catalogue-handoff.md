# Community Catalogue Contract Handoff

Date: 2026-09-25  
Contract version: 1

This note hands the completed PLVS-side portable-content boundary to the subsequent static
Catalogue implementation. It records integration facts for that implementation; it does not add
the website, submission workflow, accounts, moderation, or deployment here.

## Stable entry point

Code consumers use `src/transfer/communityContract.js`. Its independently versioned exports cover:

- exact-byte Pack V2 publication validation;
- deterministic Catalogue metadata derivation;
- canonical Item serialization and content hashing for all three families;
- deterministic Loudness Profile and Preset preview plans;
- the existing Theme gallery plan and generated-asset sealing.

Do not import internal transfer converters from the Catalogue. A breaking output change increments
the affected boundary version and, when the stable entry point itself changes incompatibly,
`COMMUNITY_CONTRACT_VERSION`.

## CI commands

For every proposed immutable artifact, in order:

```text
npm run community:validate -- path/to/item.plvsloudness
npm run community:metadata -- path/to/item.plvsloudness
```

The same commands accept `.plvspreset` and `.plvstheme`. A validation failure exits non-zero and
writes structured JSON to stderr. Success writes JSON to stdout. Catalogue CI stores the validated
artifact bytes unchanged; the reported artifact SHA-256 and byte length describe those exact bytes.

Validation requires canonical UTF-8 JSON, the correct extension, Pack V2, exactly one primary Item,
complete dependencies, publication eligibility, and all shared resource limits. It does not trust
a prior hash or a previous validation result.

## Derived metadata boundary

`community:metadata` returns only facts owned by the artifact and PLVS contracts:

- Item type, title, Pack-local Item ID, Item versions, canonical content hash, and content summary;
- exact artifact filename, media type, byte length, SHA-256, Pack kind, and Pack version;
- dependency IDs, versions, names, and canonical content hashes;
- compatibility facts and machine-derived facets;
- renderer, fixture, viewport, and required preview asset descriptors.

Author identity, description, summary copy, free tags, licence, release notes, Listing ID, slug,
release number, publication status, and download URL are Catalogue/submission fields. They are
intentionally absent and must not be inferred from the Pack.

## Preview ownership

Loudness Profile and Preset plans use the SHA-256-pinned `plvs-community-stereo-v1` fixture and a
fully fixed render environment. Presets always render their actual portable Workspace and add a
separate Dock surface only when Dock is enabled. Theme previews continue to use the versioned PLVS
Theme gallery and its exact generated-asset allowlist.

The Catalogue renderer records the artifact SHA-256, contract and renderer versions, fixture
identity/hash where applicable, viewport, and generated image SHA-256. Publisher screenshots are
not accepted as primary preview assets. Generated images are derived data and may be regenerated
after a renderer or fixture version change without mutating the artifact or its Release.

## Deferred website work

The next plan owns the static Catalogue UI, content repository/layout, submission instructions,
licence policy, moderation, independent deployment, and release-history presentation. This
handoff deliberately does not choose those open product and operational details.
