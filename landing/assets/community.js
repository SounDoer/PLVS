function values(value) {
  return value ? value.split("|") : [];
}

export function matchesCatalogueCard(dataset, query, filters) {
  const needle = query.trim().toLocaleLowerCase("en-US");
  if (needle && !dataset.search.includes(needle)) return false;
  return Object.entries(filters).every(
    ([name, selected]) => !selected || values(dataset[name]).includes(selected)
  );
}

function enhanceCatalogue() {
  const controls = document.querySelector("[data-catalogue-controls]");
  const grid = document.querySelector("[data-catalogue-grid]");
  if (!controls || !grid) return;
  const cards = [...grid.querySelectorAll(".card")];
  const search = controls.querySelector("[data-catalogue-search]");
  const filters = [...controls.querySelectorAll("[data-catalogue-filter]")];
  const empty = document.querySelector("[data-catalogue-empty]");

  const update = () => {
    const selected = Object.fromEntries(
      filters.map((input) => [input.dataset.catalogueFilter, input.value])
    );
    let visible = 0;
    for (const card of cards) {
      const matches = matchesCatalogueCard(card.dataset, search.value, selected);
      card.hidden = !matches;
      if (matches) visible += 1;
    }
    empty.hidden = visible !== 0;
  };

  controls.addEventListener("input", update);
  controls.addEventListener("reset", () => requestAnimationFrame(update));
}

if (typeof document !== "undefined") enhanceCatalogue();
