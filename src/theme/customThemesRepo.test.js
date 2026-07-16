/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { themesStore } from "../persistence/index.js";
import { makeCustomThemeFromBase } from "./customTheme.js";
import { BUILTIN_THEMES } from "./builtinThemes.js";
import {
  listCustomThemes,
  listCustomThemesOrdered,
  upsertCustomTheme,
  removeCustomTheme,
} from "./customThemesRepo.js";

function mk(id, name = "T") {
  return makeCustomThemeFromBase(BUILTIN_THEMES["plvs-dark"], name, () => id);
}

beforeEach(() => themesStore.reset());

describe("customThemesRepo", () => {
  it("upserts and lists themes", () => {
    upsertCustomTheme(mk("custom-a", "A"));
    upsertCustomTheme(mk("custom-b", "B"));
    expect(Object.keys(listCustomThemes())).toEqual(["custom-a", "custom-b"]);
    expect(listCustomThemesOrdered().map((t) => t.id)).toEqual(["custom-a", "custom-b"]);
  });
  it("updates in place without reordering", () => {
    upsertCustomTheme(mk("custom-a", "A"));
    upsertCustomTheme(mk("custom-b", "B"));
    upsertCustomTheme(mk("custom-a", "A2"));
    expect(listCustomThemesOrdered().map((t) => t.name)).toEqual(["A2", "B"]);
  });
  it("removes a theme from map and order", () => {
    upsertCustomTheme(mk("custom-a"));
    upsertCustomTheme(mk("custom-b"));
    removeCustomTheme("custom-a");
    expect(listCustomThemesOrdered().map((t) => t.id)).toEqual(["custom-b"]);
  });
  it("drops malformed persisted entries from listings", () => {
    themesStore.patch({ themes: { "custom-x": { id: "custom-x" } }, order: ["custom-x"] });
    expect(listCustomThemes()).toEqual({});
  });
});
