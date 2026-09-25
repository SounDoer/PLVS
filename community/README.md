# Community content source

This directory is the initial local checkout of the static Community Catalogue content input. It
is deliberately outside `landing/`: website code reads it only through the versioned manifest and
an explicit content-directory argument, so this tree can move to a separate repository later.

`catalogue/manifest.json` is allowed to stay empty while the Catalogue generator and UI are built.
Do not add a real Listing or artifact until the Listing/Release schema, licence policy, preview
sealing, and curator workflow are complete.

Validate this source boundary with:

```text
npm run community:source:check
npm run community:source:check -- path/to/external/catalogue
```
