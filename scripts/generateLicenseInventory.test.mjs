import { describe, expect, it } from "vitest";

import {
  collectJavascriptProductionPackages,
  collectRustRuntimePackages,
} from "./generate-license-inventory.mjs";

describe("dependency license inventory", () => {
  it("keeps the PLVS package and normal Cargo dependencies but excludes dev and build edges", () => {
    const packages = [
      { id: "plvs", name: "plvs", version: "1.0.0" },
      { id: "runtime", name: "runtime", version: "2.0.0" },
      { id: "transitive", name: "transitive", version: "3.0.0" },
      { id: "dev", name: "dev", version: "4.0.0" },
      { id: "build", name: "build", version: "5.0.0" },
    ];
    const metadata = {
      packages,
      workspace_members: ["plvs"],
      resolve: {
        nodes: [
          {
            id: "plvs",
            deps: [
              { pkg: "runtime", dep_kinds: [{ kind: null }] },
              { pkg: "dev", dep_kinds: [{ kind: "dev" }] },
              { pkg: "build", dep_kinds: [{ kind: "build" }] },
            ],
          },
          {
            id: "runtime",
            deps: [{ pkg: "transitive", dep_kinds: [{ kind: null }] }],
          },
          { id: "transitive", deps: [] },
          { id: "dev", deps: [] },
          { id: "build", deps: [] },
        ],
      },
    };

    expect(collectRustRuntimePackages(metadata).map(({ name }) => name)).toEqual([
      "plvs",
      "runtime",
      "transitive",
    ]);
  });

  it("keeps nested production npm packages and excludes the app root and dev-only entries", () => {
    const packageLock = {
      packages: {
        "": { name: "plvs", version: "1.0.0" },
        "node_modules/runtime": { version: "2.0.0", license: "MIT" },
        "node_modules/parent/node_modules/runtime": {
          version: "1.0.0",
          license: "ISC",
        },
        "node_modules/dev-only": { version: "3.0.0", dev: true, license: "MIT" },
      },
    };

    expect(collectJavascriptProductionPackages(packageLock)).toEqual([
      {
        name: "runtime",
        version: "1.0.0",
        license: "ISC",
        path: "node_modules/parent/node_modules/runtime",
      },
      {
        name: "runtime",
        version: "2.0.0",
        license: "MIT",
        path: "node_modules/runtime",
      },
    ]);
  });
});
