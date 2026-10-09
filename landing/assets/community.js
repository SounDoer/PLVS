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

export async function copyCommunityArtifact(
  url,
  { fetchImpl = fetch, clipboard = navigator.clipboard } = {}
) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`);
  await clipboard.writeText(await response.text());
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

function enhanceCopyAction() {
  const button = document.querySelector("[data-copy-artifact]");
  if (!button) return;
  const status = document.querySelector("[data-copy-status]");
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Copying…";
    try {
      await copyCommunityArtifact(button.dataset.copyArtifact);
      status.textContent = "Theme copied. Paste it in PLVS.";
    } catch (_) {
      status.textContent = "Copy failed. Use the download instead.";
    } finally {
      button.disabled = false;
    }
  });
}

if (typeof document !== "undefined") enhanceCopyAction();

function enhancePreviewGallery() {
  const gallery = document.querySelector("[data-preview-gallery]");
  if (!gallery) return;
  const choices = [...gallery.querySelectorAll("[data-preview-choice]")];
  const dialog = document.querySelector("[data-preview-dialog]");
  const full = gallery.querySelector("[data-preview-full]");
  let selected = 0;
  const select = (index) => {
    selected = (index + choices.length) % choices.length;
    const choice = choices[selected];
    const main = gallery.querySelector("[data-preview-main]");
    main.src = choice.href;
    main.alt = choice.dataset.previewLabel;
    full.href = choice.href;
    gallery.querySelector("[data-preview-caption]").textContent = choice.dataset.previewLabel;
    for (const item of choices) item.removeAttribute("aria-current");
    choice.setAttribute("aria-current", "true");
    if (dialog) {
      const enlarged = dialog.querySelector("[data-preview-enlarged]");
      enlarged.src = choice.href;
      enlarged.alt = choice.dataset.previewLabel;
      dialog.querySelector("[data-preview-enlarged-caption]").textContent =
        choice.dataset.previewLabel;
      dialog.querySelector("[data-preview-position]").textContent =
        `${selected + 1} / ${choices.length}`;
    }
  };
  choices.forEach((choice, index) => {
    choice.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      select(index);
    });
  });
  if (!dialog) return;
  full.addEventListener("click", (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    select(selected);
    dialog.showModal();
  });
  dialog.querySelector("[data-preview-close]").addEventListener("click", () => dialog.close());
  dialog
    .querySelector("[data-preview-previous]")
    .addEventListener("click", () => select(selected - 1));
  dialog.querySelector("[data-preview-next]").addEventListener("click", () => select(selected + 1));
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      select(selected + (event.key === "ArrowLeft" ? -1 : 1));
    }
  });
}

if (typeof document !== "undefined") enhancePreviewGallery();
