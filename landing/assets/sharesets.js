import { enhanceSiteNavigation } from "./site-navigation.js";

export function enhanceSharesets(root) {
  const form = root?.querySelector("[data-catalogue-controls]");
  if (!form) return;
  const cards = [...root.querySelectorAll(".resource-card")];
  const categories = [...root.querySelectorAll("[data-category]")];
  const search = form.querySelector("[data-catalogue-search]");
  const tag = form.querySelector("[data-tag-filter]");
  const toggle = form.querySelector("[data-filters-toggle]");
  const panel = form.querySelector(".filters-panel");
  const removeTag = root.querySelector("[data-remove-tag]");
  const clearEmpty = root.querySelector("[data-clear-empty]");
  const empty = root.querySelector("[data-catalogue-empty]");
  const initialTitle = document.title;
  let category = root.dataset.activeCategory;
  const tags = new Map(cards.map((card) => [card, JSON.parse(card.dataset.tags)]));
  form.hidden = false;
  clearEmpty.hidden = false;
  function update() {
    let count = 0;
    const query = search.value.trim().toLocaleLowerCase("en-US");
    for (const card of cards) {
      const visible =
        (!category || card.dataset.type === category) &&
        card.dataset.search.includes(query) &&
        (!tag.value || tags.get(card).includes(tag.value));
      card.hidden = !visible;
      if (visible) count++;
    }
    for (const link of categories) {
      if (link.dataset.category === category) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    root.querySelector("[data-result-count]").textContent =
      `${count} resource${count === 1 ? "" : "s"}`;
    empty.hidden = count !== 0;
    toggle.textContent = tag.value ? "Filters (1)" : "Filters";
    removeTag.hidden = !tag.value;
    removeTag.textContent = `${tag.value} ×`;
    removeTag.setAttribute("aria-label", `Remove ${tag.value} tag filter`);
  }
  function setCategory(value, navigate = true) {
    category = value;
    const link = categories.find((item) => item.dataset.category === category);
    if (navigate && window.location.pathname !== new URL(link.href).pathname) {
      window.history.pushState(null, "", link.href);
    }
    document.title = category ? `${link.textContent} — PLVS` : "Sharesets — PLVS";
    update();
  }
  categories.forEach((link) =>
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
        return;
      event.preventDefault();
      setCategory(link.dataset.category);
    })
  );
  window.addEventListener("popstate", () => {
    const link = categories.find(
      (item) => new URL(item.href).pathname === window.location.pathname
    );
    if (link) setCategory(link.dataset.category, false);
    else document.title = initialTitle;
  });
  search.addEventListener("input", update);
  tag.addEventListener("change", update);
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    panel.hidden = !open;
  });
  removeTag.addEventListener("click", () => {
    tag.value = "";
    update();
    toggle.focus();
  });
  function reset() {
    search.value = "";
    tag.value = "";
    setCategory("");
    search.focus();
  }
  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("reset", (event) => {
    event.preventDefault();
    reset();
  });
  clearEmpty.addEventListener("click", reset);
  update();
}

if (typeof document !== "undefined") {
  enhanceSiteNavigation(document.querySelector("[data-site-navigation]"));
  enhanceSharesets(document.querySelector(".catalogue"));
}
