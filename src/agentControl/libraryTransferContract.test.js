import { describe, expect, it } from "vitest";
import { PACK_KINDS } from "../transfer/packShape.js";
import { LIBRARY_FAMILIES, libraryPackKind } from "./libraryTransfer.js";

/// Guards the one thing nothing else would catch: a library that can be shared as a pack but has
/// no Agent Control commands, or an Agent Control family naming a library that has no pack format.
/// Both directions are silent failures -- the app works, the CLI is quietly incomplete.
describe("library transfer contract", () => {
  it("gives every pack kind an Agent Control family", () => {
    const covered = new Set(Object.keys(LIBRARY_FAMILIES).map((family) => libraryPackKind(family)));
    for (const descriptor of Object.values(PACK_KINDS)) {
      expect(covered.has(descriptor.kind), descriptor.kind).toBe(true);
    }
  });

  it("gives every Agent Control family a pack kind", () => {
    const kinds = new Set(Object.values(PACK_KINDS).map((descriptor) => descriptor.kind));
    for (const family of Object.keys(LIBRARY_FAMILIES)) {
      expect(kinds.has(libraryPackKind(family)), family).toBe(true);
    }
  });
});
