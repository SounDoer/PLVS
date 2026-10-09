export const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function siteNavigation(active = "sharesets") {
  const links = [
    ["sharesets", "/community/", "Sharesets"],
    ["docs", "/docs/", "Docs"],
    ["github", "https://github.com/SounDoer/PLVS", "GitHub"],
  ];
  return `<nav class="site-nav" aria-label="Primary" data-site-navigation>
    <a class="site-brand" href="/" aria-label="PLVS home"><img src="/assets/app-icon.svg" alt="" /></a>
    <div class="site-nav-links" id="site-nav-links">${links.map(([id, href, label]) => `<a href="${href}"${id === active ? ' aria-current="page"' : ""}${id === "github" ? ' target="_blank" rel="noopener"' : ""}>${label}</a>`).join("")}</div>
    <div class="site-nav-actions"><a class="site-download" href="/#download">Download</a><button type="button" class="button secondary site-menu" aria-controls="site-nav-links" aria-expanded="false" hidden>Menu</button></div>
  </nav>`;
}

export function resourceCard({
  attributes,
  href,
  title,
  family,
  author,
  summary,
  tags,
  image,
  hidden,
}) {
  return `<a class="resource-card card" href="${escapeHtml(href)}"${hidden ? " hidden" : ""} ${Object.entries(
    attributes
  )
    .map(([key, value]) => `data-${key}="${escapeHtml(value)}"`)
    .join(" ")}>
    ${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" />` : `<div class="resource-placeholder">${escapeHtml(family)}</div>`}
    <div class="card-body"><div class="card-meta"><span>${escapeHtml(family)}</span><span>By ${escapeHtml(author)}</span></div>
    <h2>${escapeHtml(title)}</h2><p>${escapeHtml(summary)}</p>
    <div class="card-tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div></div>
  </a>`;
}
