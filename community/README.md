# Community content source

This directory is the initial local checkout of the static Community Catalogue content input. It
is deliberately outside `landing/`: website code reads it only through the versioned manifest and
an explicit content-directory argument, so this tree can move to a separate repository later.

`catalogue/manifest.json` is allowed to stay empty while the Catalogue generator and UI are built.
Real content is added only through an explicit maintainer-curated publication workflow. The current
project does not accept or advertise public submissions.

Listing and Release records intentionally contain no per-Item licence field. Submission channels
and repository-wide contribution/publication permission are undecided and deferred until PLVS
separately chooses to design a public submission programme.

Validate this source boundary with:

```text
npm run community:source:check
npm run community:source:check -- path/to/external/catalogue
npm run community:update:check -- path/to/published/catalogue path/to/candidate/catalogue
npm run community:site -- path/to/external/catalogue path/to/output/community
```

Validation opens every Release artifact through PLVS's stable Community contract. Listing IDs,
slugs, and artifact paths must be unique; the file must be canonical UTF-8 Pack V2 content whose
actual Item family matches the Listing. Machine-owned hashes, compatibility facts, facets, and
preview requirements are derived from those bytes rather than copied into Listing JSON.

Every Release must reference exactly the preview IDs required by that derived contract. The source
validator rejects missing or additional slots, checks the PNG structure, and seals each image's
exact byte length and SHA-256 hash. Preview generation remains a PLVS-owned curator/CI operation;
the Listing format has no publisher-selected cover image or screenshot field.

The static-site command generates the Community root, all three family pages, stable Listing detail
URLs, and an isolated copy of each validated download and preview. Its default output is the ignored
`artifacts/community-site/` directory; deployment passes an explicit assembled-site destination.

The normal landing workflow publishes the Catalogue with an app Release. A separate manual
Community workflow can publish a chosen content ref sooner, but it rebuilds the rest of the site
from the latest stable Release tag. Its content checkout is isolated from the site checkout so the
path can later point at a dedicated repository without changing the validator or builder commands.
