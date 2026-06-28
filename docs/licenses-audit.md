# Dependency License Audit

A snapshot of PLVS's dependency licensing. PLVS itself is **MIT** (`LICENSE`).

**Snapshot date:** 2026-06-28 (after replacing Symphonia with a bundled FFmpeg sidecar).

## Verdict

Clean. No GPL or AGPL anywhere in either ecosystem. The only copyleft component that ships in the
desktop app is **FFmpeg (LGPL-2.1)**, which is handled (see `THIRD-PARTY-NOTICES.md`). Everything
else is permissive (MIT / Apache-2.0 / BSD / ISC), and the few copyleft build-tool dependencies are
**not distributed** in the app, so they carry no obligation.

## How to reproduce

Rust crate graph (grouped by license):

```bash
cargo install cargo-license   # one-time
cargo license --manifest-path src-tauri/Cargo.toml
```

JS packages (aggregate by license field across the installed tree):

```bash
node -e "const fs=require('fs'),p='node_modules';const o={};for(const d of fs.readdirSync(p)){if(d[0]==='.')continue;const m=d[0]==='@'?fs.readdirSync(p+'/'+d).map(s=>d+'/'+s):[d];for(const x of m){try{const j=JSON.parse(fs.readFileSync(p+'/'+x+'/package.json','utf8'));let l=j.license||'UNKNOWN';if(typeof l==='object')l=l.type||'UNKNOWN';o[l]=(o[l]||0)+1;}catch(e){}}}for(const[k,v]of Object.entries(o).sort((a,b)=>b[1]-a[1]))console.log(String(v).padStart(4),k);"
```

> Note: in a git worktree the JS tree may resolve from the main checkout's `node_modules` (Node walks
> up parent directories). Point the script at that path if the local `node_modules` is empty.

## Backend (Rust)

Dominated by `Apache-2.0 OR MIT` dual-licensing (~373 crates) and plain MIT (~140), plus permissive
variants (BSD, Zlib, Unicode-3.0, ISC, CC0). Items worth recording:

| Component | License as reported | Assessment |
|---|---|---|
| `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext`, `selectors` | **MPL-2.0** | File-level copyleft from the Tauri HTML/CSS stack. We do not modify these files → no obligation. |
| `r-efi` | `Apache-2.0 OR LGPL-2.1-or-later OR MIT` | Disjunctive (`OR`) — we take **MIT**; the LGPL option is irrelevant. |
| `voice_activity_detector` | reported as "Custom License File" | The file is standard **MIT** (© 2024 Nicholas Keenan). The bundled Silero VAD model is also MIT. |
| **FFmpeg** (bundled sidecar) | **LGPL-2.1** | Shipped. Handled via `THIRD-PARTY-NOTICES.md` + replaceable sidecar binary. |

No GPL / AGPL present.

## Frontend (JS)

~331 packages scanned: 268 MIT, 18 Apache-2.0, 15 ISC, 14 BSD-2/3-Clause, plus dual-permissive,
MIT-0, 0BSD, BlueOak-1.0.0. The only restrictive licenses are in **build tooling that is never
shipped** in the desktop bundle:

| Package | License | Why it carries no obligation |
|---|---|---|
| `@img/sharp-wasm32`, `@img/sharp-win32-x64` (libvips) | `... AND LGPL-3.0-or-later` | `sharp` is a devDependency used only to generate icons at build time. Not distributed. |
| `caniuse-lite` | `CC-BY-4.0` | Browser-compat **data** used by browserslist at build time. Not distributed. |
| `lightningcss`, `lightningcss-win32-x64-msvc` | `MPL-2.0` | CSS tool used by Tailwind/Vite at build time. Not distributed. |

## Key principles applied

- **`OR` vs `AND`:** `OR` means satisfy any one license (pick the convenient one). `AND` means satisfy
  all of them. `r-efi`'s LGPL is an `OR`, so it costs nothing.
- **Shipped vs dev-only:** A copyleft license's obligations trigger on *distribution*. Build tools
  (`sharp`/libvips, `caniuse-lite`, `lightningcss`) stay on the build machine and are not part of the
  shipped product, so their LGPL/CC-BY/MPL terms do not apply to PLVS's distribution.

## Obligations checklist (what PLVS must actually do)

- [x] FFmpeg (LGPL-2.1): attribution + source pointer + replaceable component — see
      `THIRD-PARTY-NOTICES.md`.
- [ ] Optional good practice: aggregate the permissive (MIT/Apache/BSD) license texts into the
      distribution. Can be automated later with `cargo-about` (Rust) if desired.
- [ ] Optional CI guard: `cargo-deny check licenses` to fail the build if a GPL/AGPL dependency is
      ever introduced.
