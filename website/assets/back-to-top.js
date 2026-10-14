export function enhanceBackToTop() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "back-to-top";
  button.hidden = true;
  button.setAttribute("aria-label", "back to top");
  button.title = "Back to Top";
  button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 11 6-6 6 6M12 5v14" /></svg>`;
  document.body.append(button);

  const content = document.querySelector("main");
  const place = () => {
    if (!content) return;
    const styles = getComputedStyle(button);
    const gap = parseFloat(styles.getPropertyValue("--space-5"));
    const size = parseFloat(styles.width);
    const remaining = document.documentElement.clientWidth - content.getBoundingClientRect().right;
    // Follow the reading column on wide screens; keep a safe inset on narrow screens.
    button.style.right = `max(${Math.max(gap, remaining - gap - size)}px, env(safe-area-inset-right))`;
  };
  if (content) new ResizeObserver(place).observe(content);
  place();

  const update = () => {
    button.hidden = window.scrollY < window.innerHeight;
  };
  button.addEventListener("click", () => {
    // Return keyboard focus to a visible destination before hiding this control.
    document.querySelector(".site-brand")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    update();
  });
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", () => {
    place();
    update();
  });
  update();
}
