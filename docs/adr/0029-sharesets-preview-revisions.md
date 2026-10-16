# ADR 0029: Separate Sharesets preview revisions from resource releases

Date: 2026-10-16

Status: Accepted

## Context

Sharesets screenshots change when the app's interface changes even if a Theme or Preset's saved
content remains identical. Giving identical downloads a new Release number suggests an update that
users need to import. Replacing existing screenshots in place would instead break the Catalogue's
immutable publication history and make historical image URLs change meaning.

## Decision

A resource Release tracks downloadable content. Screenshot-only refreshes append a numbered
`previewRevisions` entry to that Release or to an `included` source. Each entry has a publication
date and the complete preview set required by the existing artifact or built-in source.

The site uses the latest preview revision for galleries. Original downloads, resource Release
numbers, original preview URLs, and older revision URLs remain available. New images use distinct
paths. The publication gate protects all original previews and previously published revisions,
including their dates, paths, and byte hashes; revision numbers can only advance.

## Consequences

Curators can refresh screenshots without generating duplicate downloadable resources. Consumers
still see a new resource Release when settings or other downloadable content actually change.
The Catalogue retains extra image files intentionally to preserve published history. Site builders
and curation tooling must understand the optional field before deploying content that uses it.
