---
name: plvs-presskit
description: Build a shareable PLVS press kit ZIP with website screenshots, current Sharesets previews, color/black/white icons, verified website QR codes, and an offline image index. Use when asked for a PLVS press kit or a packaged set of media assets.
---

# PLVS Press Kit

Run from PLVS. The script reads the exact website source and Catalogue commits from the live
marker. A separate checkout, capture rig, NAS, or running app is unnecessary.

- Run `npm run presskit` for the current published website. It reads the live publication marker
  and takes website and Catalogue files from their exact Git commits, including separate content
  deployments. Missing commits are fetched from their owning repository. It does not use dirty working-tree media.
- Use `npm run presskit -- --ref <commit>` for an explicitly requested PLVS revision. A split-era release uses its
  recorded website source commit. The README and manifest identify it as an explicit-ref export; do not call it the current
  published website without checking that identity.
- Outputs go to a new directory and ZIP under `artifacts/presskit/`; previous exports are preserved.
  Never deploy the website, start desktop builds or run release workflows just to export assets.
- The kit always includes color, black and white SVG/transparent PNG icons, plus black-on-white
  and white-on-dark website QR codes in SVG/high-resolution PNG. The QR target is the canonical
  website URL with no tracking, and its background and four-module quiet zone are part of the asset.
  Black-on-white is the general-purpose default. Never crop QR borders or add a logo over the code.
- Source screenshots are preserved. Full-size homepage WebP images also get PNG compatibility
  copies; original PNGs are packaged separately. Responsive duplicates and superseded Catalogue
  previews are excluded. PNG conversion does not recover WebP detail.
- The script decodes the QR assets and checks ZIP contents and image hashes. Treat a failure as
  a failed export, not a kit to deliver. Fix the cause before rerunning.
- Open the generated `index.html` for a visual check of icons, QR codes and representative images.
  Deliver the ZIP link and identify the website/content versions. Do not send it to anyone unless
  the user explicitly asks. The generated English README and manifest travel inside the ZIP.

Implementation and focused checks: `scripts/marketing/build-presskit.mjs` and
`npm run test:marketing -- scripts/marketing/build-presskit.test.js`.
