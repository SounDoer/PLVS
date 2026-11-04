import { expect, it } from "vitest";
import { deriveAuthoringLayout } from "./authoringLayout.js";
import { UI_PREFERENCES } from "../uiPreferences.js";

const content = {
  width: 416,
  height: 388,
  bodyScrollHeight: 280,
  bodyClientHeight: 280,
  view: "theme",
  interfaceSize: "default",
  webviewScale: 2,
};
it("keeps short pages compact and caps long pages even after their viewport grows", () => {
  expect(deriveAuthoringLayout(content).height).toBe(404);
  const long = deriveAuthoringLayout({ ...content, bodyScrollHeight: 1600 });
  expect(long.height).toBe(UI_PREFERENCES.layout.editor.maxHeightPx + 16);
  const resized = deriveAuthoringLayout({
    ...content,
    height: 600,
    bodyClientHeight: 492,
    bodyScrollHeight: 1600,
  });
  expect(resized).toEqual(long);
  expect(deriveAuthoringLayout(content).height).toBe(404);
});
it("shares the same cap across Theme/Profile pages and Interface Sizes", () => {
  for (const view of ["theme", "profile"])
    for (const interfaceSize of ["small", "default", "large", "extra-large"])
      expect(
        deriveAuthoringLayout({ ...content, view, interfaceSize, bodyScrollHeight: 4000 }).height
      ).toBe(616);
});
it("retains the separate preview viewport and the Feedback sizing behavior", () => {
  expect(
    deriveAuthoringLayout({ ...content, preview: true, bodyScrollHeight: 4000 })
  ).toMatchObject({ width: 816, height: 800, preview: true });
  expect(deriveAuthoringLayout({ ...content, view: "feedback", height: 700 }).height).toBe(716);
});
