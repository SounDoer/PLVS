/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { isUiTargetId, listUiTargets, locateUiTarget } from "./uiTargets.js";

function rect(element, left, top, width = 20, height = 20) {
  element.getBoundingClientRect = () => new DOMRect(left, top, width, height);
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("UI targets", () => {
  it("accepts only semantic ids", () => {
    expect(isUiTargetId("toolbar:presets")).toBe(true);
    expect(isUiTargetId("panel:spectrum-2:settings")).toBe(true);
    expect(isUiTargetId("button.primary")).toBe(false);
    expect(isUiTargetId("[data-ui-target]")).toBe(false);
    expect(isUiTargetId("toolbar")).toBe(false);
    expect(isUiTargetId("source:{0.0.0.00000000}.{9b1c}")).toBe(true);
    expect(isUiTargetId('toolbar:"x"')).toBe(false);
  });

  it("lists declared targets and panel parts that are on screen", () => {
    document.body.innerHTML = `
      <button data-ui-target="toolbar:presets"></button>
      <button data-ui-target="toolbar:hidden"></button>
      <div data-ui-panel="spectrum"><button data-ui-part="settings"></button><div data-ui-part="body"></div></div>`;
    rect(document.querySelector('[data-ui-target="toolbar:presets"]'), 700, 10);
    rect(document.querySelector('[data-ui-target="toolbar:hidden"]'), 0, 0, 0, 0);
    rect(document.querySelector("[data-ui-panel]"), 10, 50, 400, 300);
    rect(document.querySelector('[data-ui-part="settings"]'), 380, 52);
    rect(document.querySelector('[data-ui-part="body"]'), 10, 80, 400, 270);

    expect(listUiTargets()).toEqual([
      { id: "toolbar:presets", kind: "toolbar" },
      { id: "panel:spectrum", kind: "panel" },
      { id: "panel:spectrum:settings", kind: "panel" },
      { id: "panel:spectrum:body", kind: "panel" },
    ]);
  });

  it("locates a target in viewport pixels and tells hidden from unknown", () => {
    document.body.innerHTML = `<button data-ui-target="toolbar:views"></button><button data-ui-target="toolbar:clear"></button>`;
    rect(document.querySelector('[data-ui-target="toolbar:views"]'), 650.256, 8, 28, 28);
    rect(document.querySelector('[data-ui-target="toolbar:clear"]'), 0, 0, 0, 0);

    expect(locateUiTarget("toolbar:views")).toMatchObject({
      found: true,
      visible: true,
      rect: { x: 650.26, y: 8, width: 28, height: 28 },
    });
    expect(locateUiTarget("toolbar:clear")).toMatchObject({ found: true, visible: false });
    expect(locateUiTarget("toolbar:missing")).toMatchObject({ found: false, visible: false });
  });
});
