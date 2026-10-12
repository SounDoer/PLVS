import { STATS_META } from "../src/lib/statsCatalog.js";

export const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function siteNavigation(active = "sharesets") {
  const links = [
    ["sharesets", "/sharesets/", "Sharesets"],
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
  profile,
  hidden,
}) {
  const visibleTags = tags.length > 3 ? tags.slice(0, 2) : tags;
  const hiddenTags = tags.slice(visibleTags.length);
  return `<a class="resource-card card" href="${escapeHtml(href)}"${hidden ? " hidden" : ""} ${Object.entries(
    attributes
  )
    .map(([key, value]) => `data-${key}="${escapeHtml(value)}"`)
    .join(" ")}>
    ${profile ? profilePreview(profile) : image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" />` : `<div class="resource-placeholder">${escapeHtml(family)}</div>`}
    <div class="card-body"><div class="card-meta"><span>${escapeHtml(family)}</span><span>By ${escapeHtml(author)}</span></div>
    <h2>${escapeHtml(title)}</h2><p>${escapeHtml(summary)}</p>
    <div class="card-tags" title="${escapeHtml(tags.join(", "))}">${visibleTags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}${hiddenTags.length ? `<span class="tag tag-overflow" aria-label="${hiddenTags.length} more tags: ${escapeHtml(hiddenTags.join(", "))}">+${hiddenTags.length}</span>` : ""}</div></div>
  </a>`;
}

const profileNumber = (value) => escapeHtml(String(value).replace("-", "−"));
const ruleLabel = (rule) => STATS_META[rule.metricId]?.label ?? rule.metricId;
const ruleText = (rule) => {
  const severity = rule.severity === "warn" ? "Warn" : "Fail";
  return `${escapeHtml(rule.op)} ${profileNumber(rule.value)} ${escapeHtml(STATS_META[rule.metricId]?.unit ?? "")} → <span class="profile-rule-severity profile-rule-severity-${rule.severity}">${severity}</span>`;
};

function ruleRows(rules) {
  const groups = new Map();
  for (const rule of rules) {
    if (!groups.has(rule.metricId)) groups.set(rule.metricId, []);
    groups.get(rule.metricId).push(rule);
  }
  return [...groups.values()]
    .map(
      (group) =>
        `<div><dt>${escapeHtml(ruleLabel(group[0]))}</dt><dd>${group.map((rule) => `<span>${ruleText(rule)}</span>`).join("")}</dd></div>`
    )
    .join("");
}

export function profilePreview(profile, detail = false) {
  const remaining = Math.max(0, profile.rules.length - 3);
  const reference =
    profile.referenceLufs == null ? "Not Set" : `${profileNumber(profile.referenceLufs)} LUFS`;
  return `<div class="profile-preview${detail ? " profile-preview-detail" : ""}" aria-label="Profile rule summary">
    <div class="profile-reference"><span>Reference Loudness</span><strong>${reference}</strong></div>
    <div class="profile-preview-summary">
      <dl class="profile-preview-rules">${ruleRows(profile.rules.slice(0, 3))}</dl>
      ${profile.rules.length ? "" : `<p class="profile-preview-note">No rules configured.</p>`}
      ${remaining ? `<p class="profile-preview-note">${detail ? `<a href="#profile-details">${remaining} more ${remaining === 1 ? "rule" : "rules"} · View Details</a>` : `${remaining} more ${remaining === 1 ? "rule" : "rules"}`}</p>` : ""}
    </div>
  </div>`;
}

export function profileDetails(profile) {
  if (!profile) return "";
  return `<dl class="profile-rule-details"><div><dt>Reference Loudness</dt><dd>${profile.referenceLufs == null ? "Not Set" : `${profileNumber(profile.referenceLufs)} LUFS`}</dd></div>${ruleRows(profile.rules)}</dl>`;
}
