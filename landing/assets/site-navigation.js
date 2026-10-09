export function enhanceSiteNavigation(nav) {
  if (!nav) return;
  const menu = nav.querySelector(".site-menu");
  menu.hidden = false;
  nav.dataset.enhanced = "true";
  const close = (focus = false) => {
    nav.dataset.open = "false";
    menu.setAttribute("aria-expanded", "false");
    if (focus) menu.focus();
  };
  menu.addEventListener("click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    menu.setAttribute("aria-expanded", String(open));
    nav.dataset.open = String(open);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.getAttribute("aria-expanded") === "true") close(true);
  });
  document.addEventListener("click", (event) => {
    if (!nav.contains(event.target)) close();
  });
  window.matchMedia("(max-width: 620px)").addEventListener("change", () => close());
}
