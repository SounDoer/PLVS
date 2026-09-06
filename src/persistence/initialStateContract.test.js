import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/// `window.__PLVS_INITIAL_STATE__` is one snapshot with several independent consumers: Rust
/// formats it once in `initial_state_script` and registers it as the window's initialization
/// script, and each reader below picks its own slice out of it at its own point in the module
/// graph. Nothing else ties the two sides together -- a key Rust stops injecting, or renames,
/// leaves the reader with `undefined`, which every reader here turns into its defaults without
/// an error. That is an app that comes up empty, which a user reads as lost data.
///
/// The JS-side spelling of the four domain keys is already pinned by `index.test.js` (each
/// "persists under plvs:*" case), so this file only has to close the other direction: Rust's
/// key set, and the name of the global itself.
const SOURCE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RUST_SOURCE = readFileSync(join(SOURCE_ROOT, "..", "src-tauri", "src", "lib.rs"), "utf8");
const GLOBAL_NAME = "__PLVS_INITIAL_STATE__";

/// Reader module -> the top-level keys it takes out of the snapshot.
const READERS = {
  "persistence/pluginStoreBackend.js": [
    "plvs:settings",
    "plvs:workspace",
    "plvs:presets",
    "plvs:themes",
  ],
  "hooks/useDockMode.js": ["dockState"],
  "agentControl/appSnapshot.js": ["agentControl"],
};

function productionSources(directory = SOURCE_ROOT) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(path);
    if (![".js", ".jsx"].includes(extname(entry.name)) || entry.name.includes(".test.")) return [];
    return [{ path, projectPath: relative(SOURCE_ROOT, path).replaceAll("\\", "/") }];
  });
}

/// The body of Rust's `initial_state_script`, and nothing else: `lib.rs` also carries the tests
/// that read the snapshot back, which mention the same key and global names.
function scriptFunctionBody() {
  const start = RUST_SOURCE.indexOf("fn initial_state_script");
  expect(start, "src-tauri/src/lib.rs declares initial_state_script").toBeGreaterThan(-1);
  const end = RUST_SOURCE.indexOf("\n}\n", start);
  expect(end, "initial_state_script has a body").toBeGreaterThan(start);
  return RUST_SOURCE.slice(start, end);
}

function injectedKeys() {
  const body = scriptFunctionBody();
  return new Set([...body.matchAll(/"([^"]+)":/g)].map(([, key]) => key));
}

describe("injected initial state contract", () => {
  it("enumerates every reader of the injected snapshot", () => {
    // Not a correctness check on its own -- it exists so the key cross-reference below cannot
    // quietly stop covering a reader. A fourth one added without a line in READERS would
    // otherwise never be compared against what Rust injects.
    const found = productionSources()
      .filter(({ path }) => readFileSync(path, "utf8").includes(GLOBAL_NAME))
      .map(({ projectPath }) => projectPath)
      .sort();
    expect(found).toEqual(Object.keys(READERS).sort());
  });

  it("has Rust inject every key a reader consumes", () => {
    const injected = injectedKeys();
    for (const [reader, keys] of Object.entries(READERS)) {
      for (const key of keys) {
        expect(injected.has(key), `${reader} reads ${key}`).toBe(true);
      }
    }
  });

  it("has Rust assign the global under the name the readers use", () => {
    expect(scriptFunctionBody()).toContain(`window.${GLOBAL_NAME} = `);
  });
});
