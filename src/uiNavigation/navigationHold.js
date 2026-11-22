/**
 * Keeps what Agent Control opened open while the agent's own app takes focus back.
 *
 * Popovers and dropdowns close when the PLVS window loses focus, as native menus close when the
 * user switches apps. An agent opens them with `ui show`, which brings PLVS forward, and focus then
 * returns to the agent's terminal or app: that blur would close the surface before the agent can
 * screenshot or inspect it. While a hold is active, a close that arrives with the window unfocused
 * is ignored. Every other close still applies: `ui close`, Escape, or a click elsewhere in PLVS,
 * which can only happen with the window focused. The user's first pointer or key input in the
 * window ends the hold, so surfaces the user opens behave as before.
 */

let held = false;
let listening = null;

function release() {
  held = false;
}

/** Called when UI Navigation is about to open a surface. */
export function holdNavigationSurfaces(documentObject = globalThis.document) {
  held = true;
  if (!documentObject || listening === documentObject) return;
  for (const type of ["pointerdown", "keydown"]) {
    documentObject.addEventListener(type, release, true);
  }
  listening = documentObject;
}

/** Whether a surface Agent Control opened is being held across window blur. */
export function navigationSurfacesHeld() {
  return held;
}

/**
 * Whether a close request should be ignored: Agent Control holds the surface and the request came
 * while the window has no focus, which only switching apps produces.
 */
export function ignoresUnfocusedClose(documentObject = globalThis.document) {
  return held && documentObject?.hasFocus?.() === false;
}

/** Test support: forget the hold and its listeners. */
export function resetNavigationHold() {
  if (listening) {
    for (const type of ["pointerdown", "keydown"]) {
      listening.removeEventListener(type, release, true);
    }
  }
  listening = null;
  held = false;
}
