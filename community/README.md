# Community content source

This directory is the initial local checkout of the static Community Catalogue content input. It
is deliberately outside `landing/`: website code reads it only through the versioned manifest and
an explicit content-directory argument, so this tree can move to a separate repository later.

`catalogue/manifest.json` is allowed to stay empty while the Catalogue generator and UI are built.
Do not add a real Listing or artifact until the Listing/Release schema, repository-wide submission
permission, preview sealing, and curator workflow are complete.

Listing and Release records intentionally contain no per-Item licence field. Before third-party
submissions open, this content repository will define one contribution/publication permission rule
that applies to every accepted artifact.

Validate this source boundary with:

```text
npm run community:source:check
npm run community:source:check -- path/to/external/catalogue
```

Validation opens every Release artifact through PLVS's stable Community contract. Listing IDs,
slugs, and artifact paths must be unique; the file must be canonical UTF-8 Pack V2 content whose
actual Item family matches the Listing. Machine-owned hashes, compatibility facts, facets, and
preview requirements are derived from those bytes rather than copied into Listing JSON.
