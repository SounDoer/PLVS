/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";

import { installKeyboardNavigationTracking } from "./keyboardNavigation.js";

const isNavigating = () => document.documentElement.getAttribute("data-keyboard-nav") === "true";
const press = (key, init = {}) =>
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));

describe("keyboard navigation tracking", () => {
  let uninstall = () => {};

  afterEach(() => {
    uninstall();
    document.documentElement.removeAttribute("data-keyboard-nav");
  });

  it("starts outside keyboard navigation", () => {
    uninstall = installKeyboardNavigationTracking();

    expect(isNavigating()).toBe(false);
  });

  it("enters keyboard navigation on Tab, in either direction", () => {
    uninstall = installKeyboardNavigationTracking();

    press("Tab", { shiftKey: true });

    expect(isNavigating()).toBe(true);
  });

  it("ignores shortcuts and bare modifiers, which are not navigation", () => {
    uninstall = installKeyboardNavigationTracking();

    press("Control");
    press("k", { ctrlKey: true });
    press("Escape");
    press(" ");

    expect(isNavigating()).toBe(false);
  });

  it("leaves keyboard navigation when the pointer is used", () => {
    uninstall = installKeyboardNavigationTracking();
    press("Tab");

    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(isNavigating()).toBe(false);
  });

  it("still sees a Tab that a component stopped from bubbling", () => {
    uninstall = installKeyboardNavigationTracking();
    const field = document.body.appendChild(document.createElement("input"));
    field.addEventListener("keydown", (event) => event.stopPropagation());

    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

    expect(isNavigating()).toBe(true);
    field.remove();
  });

  it("stops tracking once uninstalled", () => {
    installKeyboardNavigationTracking()();

    press("Tab");

    expect(isNavigating()).toBe(false);
  });
});
