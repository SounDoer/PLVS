/// Tells the stylesheet whether the user is moving focus with the keyboard.
///
/// The browser's own `:focus-visible` heuristic turns on after any keydown, a bare modifier
/// included. PLVS is driven by shortcuts, so a pointer user who pressed Ctrl+K and then clicked a
/// button got a focus ring they never asked for; that is why the browser's outline is suppressed in
/// `index.css`. Tab is the one key that means "I am navigating by keyboard", so the ring follows
/// this attribute instead: set on Tab, cleared the next time the pointer is pressed.
///
/// Capture phase on purpose: a field that stops a keydown from bubbling must not hide the Tab.

const ATTRIBUTE = "data-keyboard-nav";

export function installKeyboardNavigationTracking(target = document) {
  const root = target.documentElement;
  const onKeyDown = (event) => {
    if (event.key === "Tab") root.setAttribute(ATTRIBUTE, "true");
  };
  const onPointerDown = () => root.removeAttribute(ATTRIBUTE);

  target.addEventListener("keydown", onKeyDown, true);
  target.addEventListener("pointerdown", onPointerDown, true);
  return () => {
    target.removeEventListener("keydown", onKeyDown, true);
    target.removeEventListener("pointerdown", onPointerDown, true);
    root.removeAttribute(ATTRIBUTE);
  };
}
