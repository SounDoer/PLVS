# Graph Tooling For PLVS

PLVS has two code worlds:

- `src/`: React, hooks, UI panels, persistence, theme code.
- `src-tauri/`: Rust, Tauri commands, audio capture, DSP, window state.

No single graph tool understands both worlds perfectly, so use a small toolkit.

## Recommended Tools

### dependency-cruiser

Best first tool for the frontend.

Use it to:

- Draw dependency graphs for `src/`.
- Find circular imports.
- Add architecture rules later, such as "components should not import
  `@tauri-apps/api` directly."
- Export `dot`, `svg`, `html`, `json`, or `mermaid`.

Typical command:

```powershell
npx depcruise src --include-only "^src" --output-type mermaid
```

For SVG output, Graphviz is also needed:

```powershell
npx depcruise src --include-only "^src" --output-type dot | dot -Tsvg > docs/architecture-maps/frontend-dependencies.svg
```

### Madge

Best quick-look tool for frontend imports.

Use it when you want a fast answer to:

- "What imports what?"
- "Are there circular dependencies?"
- "Which modules are leaves or orphans?"

Typical commands:

```powershell
npx madge --extensions js,jsx src
npx madge --extensions js,jsx --circular src
```

For SVG output:

```powershell
npx madge --extensions js,jsx --image docs/architecture-maps/frontend-madge.svg src
```

### cargo-modules

Best first tool for Rust structure.

Use it to:

- Print the Rust module tree.
- Graph internal module dependencies.
- Find orphan Rust files not wired into `mod.rs` / `lib.rs`.

Typical commands:

```powershell
cargo modules structure --manifest-path src-tauri/Cargo.toml --no-fns --no-types --no-traits
cargo modules dependencies --manifest-path src-tauri/Cargo.toml --no-fns --no-types --no-traits --no-sysroot
```

For Graphviz:

```powershell
cargo modules dependencies --manifest-path src-tauri/Cargo.toml --no-fns --no-types --no-traits --no-sysroot > docs/architecture-maps/rust-modules.dot
dot -Tsvg docs/architecture-maps/rust-modules.dot > docs/architecture-maps/rust-modules.svg
```

### Graphviz

Graphviz is the renderer many tools use to turn `dot` text into SVG/PNG images.
It does not understand PLVS by itself; it draws graph files produced by other tools.

Typical command:

```powershell
dot -Tsvg input.dot > output.svg
```

## Why These Maps Are Manual First

The first maps in this folder are Mermaid diagrams written from the real code
paths. That is intentional:

- Manual maps are easier for a beginner to read.
- They can show product-level meaning, not only import edges.
- Auto-generated graphs get noisy quickly in a React app.

Once the manual maps make sense, generated graphs become useful for checking
whether the code still matches the architecture.
