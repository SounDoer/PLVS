/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { enhanceSharesets } from "./sharesets.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Sharesets browsing", () => {
  it("combines category, search and exact tags, exposes hidden filters, and clears back to all", () => {
    document.body.innerHTML = `<main class="catalogue" data-active-category="">
      <a data-category="" href="/community/">All</a>
      <a data-category="themes" href="/community/themes/">Themes</a>
      <form data-catalogue-controls hidden><input data-catalogue-search />
      <button type="button" data-filters-toggle aria-expanded="false"></button>
      <div class="filters-panel" hidden><select data-tag-filter><option value=""></option><option>Dark|Amber</option><option>Stereo</option></select></div></form>
      <p data-result-count></p><button data-remove-tag hidden></button>
      <a class="resource-card" data-type="themes" data-search="signal amber" data-tags='["Dark|Amber"]'></a>
      <a class="resource-card" data-type="presets" data-search="stereo overview" data-tags='["Stereo"]'></a>
      <div data-catalogue-empty hidden><button data-clear-empty hidden></button></div>
    </main>`;
    // Use the jsdom origin while retaining production route semantics.
    window.history.replaceState(null, "", "/community/");
    const root = document.querySelector("main");
    enhanceSharesets(root);
    const count = () => root.querySelector("[data-result-count]").textContent;
    const search = root.querySelector("input");
    const tag = root.querySelector("select");
    const form = root.querySelector("form");
    const toggle = root.querySelector("[data-filters-toggle]");
    expect(form.hidden).toBe(false);
    root.querySelector('[data-category="themes"]').click();
    expect(window.location.pathname).toBe("/community/themes/");
    search.value = " AMBER ";
    search.dispatchEvent(new Event("input"));
    tag.value = "Dark|Amber";
    tag.dispatchEvent(new Event("change"));
    expect(count()).toBe("1 resource");
    toggle.click();
    tag.value = "Stereo";
    tag.dispatchEvent(new Event("change"));
    toggle.click();
    expect(count()).toBe("0 resources");
    expect(root.querySelector(".filters-panel").hidden).toBe(true);
    expect(root.querySelector("[data-remove-tag]").hidden).toBe(false);
    expect(root.querySelector("[data-catalogue-empty]").hidden).toBe(false);
    root.querySelector("[data-remove-tag]").click();
    expect(count()).toBe("1 resource");
    expect(document.activeElement).toBe(toggle);
    form.reset();
    expect(count()).toBe("2 resources");
    expect(search.value).toBe("");
    expect(window.location.pathname).toBe("/community/");
    expect(document.activeElement).toBe(search);
    window.history.replaceState(null, "", "/community/themes/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(count()).toBe("1 resource");
    expect(root.querySelector('[data-category="themes"]').getAttribute("aria-current")).toBe(
      "page"
    );
  });
});
