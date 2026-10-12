# Sharesets content source

Website presentation rules and the shared source are documented in
[`docs/website-design.md`](../docs/website-design.md).

This directory is the initial local checkout of the static Sharesets Catalogue content input. It
is deliberately outside `website/`: website code reads it only through the versioned manifest and
an explicit content-directory argument, so this tree can move to a separate repository later.

`catalogue/manifest.json` contains the curated Sharesets catalogue. Previews are generated from the
current production components with the pinned renderer. An empty manifest remains valid for
fixtures and bootstrap; it must never replace a Catalogue with published history.
Real content is added only through an explicit maintainer-curated publication workflow. The current
project does not accept or advertise public submissions.

Listing and Release records intentionally contain no per-Item licence field. Submission channels
and repository-wide contribution/publication permission are undecided and deferred until PLVS
separately chooses to design a public submission programme.

Validate this source boundary with:

```text
npm run sharesets:source:check
npm run sharesets:source:check -- path/to/external/catalogue
npm run sharesets:update:check -- path/to/published/catalogue path/to/candidate/catalogue
npm run sharesets:site -- path/to/external/catalogue path/to/output/sharesets
```

Validation opens every Release artifact through PLVS's stable Sharesets contract. Listing IDs,
slugs, and artifact paths must be unique; the file must be canonical UTF-8 Pack V2 content whose
actual Item family matches the Listing. Machine-owned hashes, compatibility facts, facets, and
preview requirements are derived from those bytes rather than copied into Listing JSON.

An official Listing may instead declare an `included` source that identifies content built into
PLVS. The validator resolves that ID through the production registry and derives the same metadata
and preview contract from the current built-in document. Included content has no downloadable
Release artifact; its detail page shows `Included with PLVS` and omits import instructions, file
metadata, and Release History.

Every Release or included source must reference exactly the preview IDs required by that derived
contract. Loudness Profiles require none because their structured rules render the Catalogue card
and detail page directly. For Presets and Themes, the source validator rejects missing or additional
slots, checks the PNG structure, and seals each image's exact byte length and SHA-256 hash. Preview
generation remains a PLVS-owned curator/CI operation; the Listing format has no publisher-selected
cover image or screenshot field.

The static-site command generates the Sharesets root, all three family pages, stable Listing detail
URLs, and an isolated copy of each validated download and preview. Its default output is the ignored
`artifacts/sharesets-site/` directory; deployment passes an explicit assembled-site destination.

The normal website workflow publishes the Catalogue with an app Release. A separate manual
Sharesets workflow can publish a chosen content ref sooner, but it rebuilds the rest of the site
from the latest stable Release tag. Its content checkout is isolated from the site checkout so the
path can later point at a dedicated repository without changing the validator or builder commands.
Both entry points call the same `publish-site.yml` workflow. The deployed Catalogue records its
exact content commit in `sharesets/publication.json`; every deployment reads that marker and refuses
any candidate that rewrites its published history. See CONTRIBUTING.md for first-publication
bootstrap and recovery. Content-only additions must be brought back into the next app release's
content tree before that release can replace the website.
