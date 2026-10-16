import {
  presetExtraDetails,
  presetPanels,
  presetUsesPanelOrientation,
} from "./preset-presentation.mjs";
import { MODULE_CATALOG } from "../src/workspace/moduleCatalog.js";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { marked } from "marked";
import {
  escapeHtml,
  siteNavigation,
  resourceCard,
  profilePreview,
  profileDetails,
} from "./site-components.mjs";
import { readSharesetsSource } from "./sharesets-catalogue-source.mjs";

const FAMILIES = {
  loudness: { label: "Loudness Profiles", singular: "Loudness Profile" },
  presets: { label: "Presets", singular: "Preset" },
  themes: { label: "Themes", singular: "Theme" },
};

const COPY_NOUNS = { loudness: "Profile", presets: "Preset", themes: "Theme" };
// Sharesets launched with 0.20.0 and supports no earlier app: some Items need its metric ids, and
// earlier apps answer a pasted Preset or Profile with a Theme error. Newer saved controls may
// require a newer build; do not present this launch floor as sufficient for those Presets.
const SHARESETS_MINIMUM_APP_VERSION = "0.20.0";

const THEME_GALLERY_ORDER = [
  "product-workspace-file",
  "product-multichannel-monitoring",
  "product-workspace-snapshot",
  "semantic-overview",
];

const THEME_PREVIEW_LABELS = {
  "product-workspace-file": "Workspace",
  "product-multichannel-monitoring": "Multichannel Monitoring",
  "product-workspace-snapshot": "Snapshot",
  "semantic-overview": "Theme Colors",
};

const PRESET_PREVIEW_LABELS = {
  "preset-workspace-stereo": "Stereo",
  "preset-workspace-5-1": "5.1",
};

const SHARESETS_SITE_ASSETS = [
  "sharesets.css",
  "sharesets.js",
  "sharesets-detail.css",
  "sharesets-detail.js",
  "site-components.css",
  "site-chrome.css",
  "site-navigation.js",
  "site-tokens.css",
];

export function detailGallery(type, previews) {
  if (type === "loudness") return [];
  if (type !== "themes") return previews.slice(0, 5);
  const byId = new Map(previews.map((preview) => [preview.id, preview]));
  return THEME_GALLERY_ORDER.flatMap((id) => (byId.has(id) ? [byId.get(id)] : []));
}

export function previewLabel(preview) {
  return (
    PRESET_PREVIEW_LABELS[preview.id] ??
    THEME_PREVIEW_LABELS[preview.id] ??
    preview.id
      .replace(/^product-/, "")
      .replace(/-file$/, "")
      .replaceAll("-", " ")
  );
}

function page(title, description, body, { browse = false } = {}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="stylesheet" href="/assets/site-tokens.css" />
    <link rel="stylesheet" href="/assets/site-components.css" />
    <link rel="stylesheet" href="/assets/site-chrome.css" />
    ${browse ? `<link rel="stylesheet" href="/assets/sharesets.css" /><script type="module" src="/assets/sharesets.js"></script>` : `<link rel="stylesheet" href="/assets/sharesets-detail.css" /><script type="module" src="/assets/sharesets-detail.js"></script>`}
  </head>
  <body class="site-background">
    ${siteNavigation()}
    ${body}
    <footer><a href="/">Back to PLVS</a></footer>
  </body>
</html>
`;
}

function typeNav(active = null) {
  return `<nav class="categories family-nav" aria-label="Sharesets categories">
    <a class="category" data-category="" href="/sharesets/"${active === null ? ' aria-current="page"' : ""}>All</a>
    ${Object.entries(FAMILIES)
      .map(
        ([type, family]) =>
          `<a class="category" data-category="${type}" href="/sharesets/${type}/"${active === type ? ' aria-current="page"' : ""}>${family.label}</a>`
      )
      .join("\n    ")}
  </nav>`;
}

function latestPublished(listing) {
  return [...listing.releases].reverse().find(({ status }) => status === "published") ?? null;
}

function currentContent(listing) {
  const content = listing.included ?? latestPublished(listing);
  const revision = content?.previewRevisions?.at(-1);
  return revision
    ? { ...content, previews: revision.previews, previewRevision: revision.number }
    : content;
}

function contentFilesPath(listing, content) {
  return `/sharesets/files/${listing.id}/${listing.included ? "included" : `v${content.number}`}${content.previewRevision ? `/previews/r${content.previewRevision}` : ""}`;
}

function card(listing, activeType) {
  const release = currentContent(listing);
  const facets = release?.metadata.facets ?? {};
  const preview =
    release?.previews.find((item) => item.id === "product-workspace-file") ?? release?.previews[0];
  const previewUrl = preview ? `${contentFilesPath(listing, release)}/${preview.id}.png` : null;
  const referenceSearch = listing.references.flatMap(
    ({ publisher, title, edition, relevanceMarkdown }) => [
      publisher,
      title,
      edition ?? "",
      relevanceMarkdown,
    ]
  );
  const searchText = [
    listing.title,
    listing.summary,
    listing.descriptionMarkdown,
    ...listing.tags,
    ...referenceSearch,
  ]
    .join(" ")
    .toLocaleLowerCase("en-US");
  const attributes = {
    search: searchText,
    type: listing.type,
    tags: JSON.stringify(listing.tags),
    module: (facets.moduleIds ?? []).join("|"),
    metric: (facets.metricIds ?? []).join("|"),
    scheme: facets.themeScheme ?? "",
    feature: (facets.optionalCapabilities ?? []).join("|"),
    dependency: (facets.dependencyIds ?? []).join("|"),
  };
  return resourceCard({
    attributes,
    href: `/sharesets/${listing.type}/${listing.slug}/`,
    title: listing.title,
    family: FAMILIES[listing.type].singular,
    author: listing.author?.name ?? "PLVS curators",
    summary: listing.summary,
    tags: listing.tags,
    image: previewUrl,
    profile: listing.profile,
    hidden: Boolean(activeType && listing.type !== activeType),
  });
}

function browseControls(listings) {
  const tags = [...new Set(listings.flatMap((listing) => listing.tags))].sort((a, b) =>
    a.localeCompare(b, "en-US")
  );
  return `<form data-catalogue-controls role="search" aria-label="Search resources" hidden>
    <div class="browse-toolbar"><div class="field search-field"><input type="search" data-catalogue-search aria-label="Search Sharesets" placeholder="Search Sharesets" /></div>
    <button class="button secondary" type="button" data-filters-toggle aria-expanded="false" aria-controls="catalogue-filters">Filters</button><button class="button secondary" type="reset">Clear All</button></div>
    <div class="filters-panel" id="catalogue-filters" hidden><label class="field"><span>Tag</span><select data-tag-filter><option value="">All Tags</option>${tags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join("")}</select></label></div>
  </form>`;
}

function browsePage(listings, activeType = null) {
  const visible = activeType ? listings.filter(({ type }) => type === activeType) : listings;
  const title = activeType ? FAMILIES[activeType].label : "Sharesets";
  const intro = "Loudness Profiles, Presets, and Themes for PLVS";
  return page(
    `${title} — PLVS`,
    intro,
    `<main class="catalogue" data-active-category="${activeType ?? ""}">
      <header class="hero"><h1>Sharesets</h1><p>${intro}</p></header>
      ${typeNav(activeType)}
      ${listings.length ? browseControls(listings) : ""}
      <div class="result-line"><p class="helper" data-result-count aria-live="polite">${visible.length} resource${visible.length === 1 ? "" : "s"}</p><button type="button" class="remove-filter" data-remove-tag hidden></button></div>
      ${listings.length ? `<section class="card-grid" data-catalogue-grid aria-label="Resources">${listings.map((listing) => card(listing, activeType)).join("\n")}</section><section class="empty" data-catalogue-empty${visible.length ? " hidden" : ""}><h2>No Matching Resources</h2><p>Try another search or clear all filters.</p><button class="button secondary" type="button" data-clear-empty hidden>Clear All</button></section>` : `<section class="empty"><h2>Nothing published yet</h2><p>Resources will appear here when they are published.</p></section>`}
    </main>`,
    { browse: true }
  );
}

function renderSummary(summary) {
  return Object.entries(summary)
    .map(([key, value]) => {
      const label = key.replaceAll(/([A-Z])/g, " $1").replace(/^./, (part) => part.toUpperCase());
      const display = Array.isArray(value) ? value.join(", ") || "None" : String(value);
      return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(display)}</dd></div>`;
    })
    .join("");
}

function renderCompatibility(metadata) {
  const entries = [
    ["Modules", metadata.facets.moduleIds],
    ["Metrics", metadata.facets.metricIds],
    ["Theme scheme", metadata.facets.themeScheme ? [metadata.facets.themeScheme] : []],
    ["Optional features", metadata.facets.optionalCapabilities],
  ].filter(([, values]) => values.length > 0);
  return entries.length > 0
    ? `<dl>${entries.map(([label, values]) => `<div><dt>${label}</dt><dd>${values.map(escapeHtml).join(", ")}</dd></div>`).join("")}</dl>`
    : `<p class="muted">No optional compatibility requirements.</p>`;
}

function renderDependencies(metadata) {
  if (metadata.dependencies.length === 0) return `<p class="muted">No bundled dependencies.</p>`;
  return `<ul class="dependency-list">${metadata.dependencies.map((dependency) => `<li><strong>${escapeHtml(dependency.name)}</strong><span>${escapeHtml({ "plvs-loudness-profile": "Loudness Profile", "plvs-theme": "Theme", "plvs-preset": "Preset" }[dependency.kind] ?? dependency.kind)}</span></li>`).join("")}</ul>`;
}

function renderReferences(references) {
  if (references.length === 0) return "";
  return `<section class="profile-sources"><h2>Sources</h2><div class="source-list">${references
    .map(
      (reference) =>
        `<article class="source-card"><h3><a href="${escapeHtml(reference.url)}" target="_blank" rel="noopener">${escapeHtml(reference.title)}</a></h3><p class="source-meta">${escapeHtml(reference.publisher)}${reference.edition ? ` · ${escapeHtml(reference.edition)}` : ""}</p><div class="markdown">${marked.parse(reference.relevanceMarkdown)}</div></article>`
    )
    .join("")}</div></section>`;
}

function renderPresetDetails(metadata) {
  const summary = metadata.content.summary;
  const entries = [
    ["Workspace Panels", summary.workspacePanelCount],
    ["Modules", metadata.facets.moduleIds.map((id) => MODULE_CATALOG[id]?.title ?? id).join(", ")],
    ["Dock", summary.dockEnabled ? "On" : "Off"],
    ...(summary.dockEnabled ? [["Dock Panels", summary.dockPanelCount]] : []),
  ];
  return entries
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
}

function detailPage(listing, profile = null) {
  const isProfile = listing.type === "loudness";
  const isPreset = listing.type === "presets";
  const compactDetail = listing.type === "themes" || isProfile || isPreset;
  const isIncluded = Boolean(listing.included);
  const current = currentContent(listing);
  const metadata = current?.metadata;
  const previews = current?.previews ?? [];
  const author = listing.author
    ? listing.author.url
      ? `<a href="${escapeHtml(listing.author.url)}" rel="author noopener">${escapeHtml(listing.author.name)}</a>`
      : escapeHtml(listing.author.name)
    : "PLVS curators";
  const currentDownload =
    current && !isIncluded
      ? `/sharesets/files/${listing.id}/v${current.number}/${basename(current.artifact)}`
      : null;
  const copyNoun = COPY_NOUNS[listing.type];
  const appRequirement =
    isPreset && presetUsesPanelOrientation(listing.presetPack)
      ? "Requires a PLVS build with panel orientation controls, introduced after 0.20.0."
      : `Requires PLVS ${SHARESETS_MINIMUM_APP_VERSION}+`;
  const primaryAction = isIncluded
    ? `<div class="actions"><span class="included-label">Included with PLVS</span></div>`
    : current
      ? `<div class="theme-download"><p class="theme-version"><a href="#release-history">Release ${current.number}</a><span aria-hidden="true">·</span><span>${escapeHtml(appRequirement)}</span></p><div class="actions"><button class="button" type="button" data-copy-artifact="${currentDownload}" data-copy-noun="${copyNoun}">Copy ${copyNoun}</button><a class="button secondary" href="${currentDownload}" download>Download ${extname(current.artifact)}</a><span class="copy-status" data-copy-status aria-live="polite"></span></div></div>`
      : "";
  const releases = [...listing.releases]
    .reverse()
    .map((release) => {
      const download = `/sharesets/files/${listing.id}/v${release.number}/${basename(release.artifact)}`;
      const isCompact = compactDetail;
      const isCurrent = release.number === current?.number;
      const currentLabel =
        isCompact && isCurrent && listing.releases.length > 1
          ? `<span class="release-current">Current</span>`
          : "";
      const historicalLink =
        isCompact && release.status === "published" && !isCurrent
          ? `<a class="release-download" href="${download}" download>Download v${release.number}</a>`
          : "";
      const releaseAction =
        release.status !== "published"
          ? `<p class="withdrawn">Withdrawn: ${escapeHtml(release.withdrawalReason)}</p>`
          : isCompact
            ? ""
            : `<a class="button secondary" href="${download}" download>Download</a>`;
      return `<article class="release">
        <div><h3>Release ${release.number}</h3>${currentLabel}<p>${escapeHtml(release.publishedAt)} · ${escapeHtml(release.status)}</p>${historicalLink}</div>
        <div class="markdown">${marked.parse(release.notesMarkdown)}</div>
        ${releaseAction}
      </article>`;
    })
    .join("\n");
  if (compactDetail) {
    const gallery = detailGallery(listing.type, previews);
    const previewUrl = (preview) => `${contentFilesPath(listing, current)}/${preview.id}.png`;
    return page(
      `${listing.title} — PLVS Sharesets`,
      listing.summary,
      `<main class="detail theme-detail${isProfile ? " profile-detail" : ""}">
        <p class="breadcrumb"><a href="/sharesets/">Sharesets</a> / <a href="/sharesets/${listing.type}/">${FAMILIES[listing.type].label}</a></p>
        <div class="theme-layout">
          ${
            isProfile && profile
              ? profilePreview(profile, true)
              : gallery.length
                ? `<div class="theme-gallery" data-preview-gallery>
            <figure><a data-preview-full href="${previewUrl(gallery[0])}" aria-label="Enlarge preview"><img class="theme-main-preview" data-preview-main src="${previewUrl(gallery[0])}" alt="${escapeHtml(previewLabel(gallery[0]))}" /></a><figcaption data-preview-caption>${escapeHtml(previewLabel(gallery[0]))}</figcaption></figure>
            <div class="theme-thumbnails"${gallery.length === 1 ? " hidden" : ""} aria-label="${FAMILIES[listing.type].singular} previews">${gallery.map((preview, index) => `<a href="${previewUrl(preview)}" data-preview-choice data-preview-label="${escapeHtml(previewLabel(preview))}" aria-label="View ${escapeHtml(previewLabel(preview))}"${index === 0 ? ' aria-current="true"' : ""}><img src="${previewUrl(preview)}" alt="" loading="lazy" /></a>`).join("")}</div>
          </div>`
                : ""
          }
          <header class="theme-summary"><h1>${escapeHtml(listing.title)}</h1><p class="byline">By ${author}</p>${isProfile ? `<p class="lede">${escapeHtml(listing.summary)}</p>` : isPreset ? `<div class="lede profile-description">${marked.parse(listing.descriptionMarkdown)}</div>` : `<p class="lede">${escapeHtml(listing.summary)}</p>`}${listing.tags.length ? `<div class="theme-tags" aria-label="Tags">${listing.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}${primaryAction.replace(/Download \.\w+</, "Download<")}
            ${!isIncluded && !current ? `<p class="withdrawn">No current release is available.</p>` : ""}
            ${!isPreset && metadata?.dependencies.length ? `<div class="theme-requirements"><h2>Required Items</h2>${renderDependencies(metadata)}</div>` : ""}
          </header>
        </div>
        <div class="theme-more">
          ${!isIncluded && current ? `<section class="theme-how"><h2>How to Use</h2><p><strong>Copy ${copyNoun}</strong>, then paste in PLVS outside a text field to review the import.</p><p>Or download the file and choose <strong>Settings → Saved Items → Import…</strong>.</p><p>Confirm the import, then ${isPreset ? "apply the Preset from your Library" : isProfile ? "select the Profile in PLVS" : "apply the Theme from your Library"}.${isProfile || isPreset ? " Importing does not apply it automatically." : ""}</p></section>` : ""}
          <section${isProfile ? ' id="profile-details"' : ""}><h2>Details</h2>${isProfile ? `<div class="markdown profile-guidance">${marked.parse(listing.descriptionMarkdown)}</div>` : ""}${metadata ? `<div class="theme-facts">${isProfile ? profileDetails(profile) : ""}<dl>${isIncluded ? "<div><dt>Availability</dt><dd>Included with PLVS</dd></div>" : ""}${isProfile ? "" : isPreset ? renderPresetDetails(metadata) : renderSummary(metadata.content.summary)}${isPreset && listing.presetPack ? presetExtraDetails(listing.presetPack) : ""}${isIncluded ? "" : `<div><dt>File Size</dt><dd>${metadata.artifact.byteLength.toLocaleString("en-US")} bytes</dd></div>`}</dl></div>${isIncluded ? "" : `<details class="theme-checksum"><summary>File Checksum</summary><p class="hash">${escapeHtml(metadata.artifact.sha256)}</p></details>`}` : `<p class="muted">No current release is available.</p>`}</section>
        </div>
        ${renderReferences(listing.references)}
        ${isPreset && listing.presetPack ? presetPanels(listing.presetPack) : ""}
        ${isIncluded ? "" : `<section class="release-history" id="release-history"><h2>Release History</h2><div class="release-list">${releases}</div></section>`}
        ${gallery.length ? `<dialog class="preview-dialog" aria-label="${FAMILIES[listing.type].singular} preview" data-preview-dialog><div class="preview-toolbar"><button class="button secondary" type="button" data-preview-previous${gallery.length === 1 ? " hidden" : ""} aria-label="Previous image">←</button><span data-preview-position${gallery.length === 1 ? " hidden" : ""} aria-live="polite"></span><button class="button secondary" type="button" data-preview-next${gallery.length === 1 ? " hidden" : ""} aria-label="Next image">→</button><button class="button secondary" type="button" data-preview-close autofocus>Close</button></div><img data-preview-enlarged alt="" /><p data-preview-enlarged-caption></p></dialog>` : ""}
      </main>`
    );
  }
  return page(
    `${listing.title} — PLVS Sharesets`,
    listing.summary,
    `<main class="detail">
      <p class="breadcrumb"><a href="/sharesets/">Sharesets</a> / <a href="/sharesets/${listing.type}/">${FAMILIES[listing.type].label}</a></p>
      <header class="detail-hero"><div><p class="eyebrow">${FAMILIES[listing.type].singular} · ${escapeHtml(listing.classification)}</p><h1>${escapeHtml(listing.title)}</h1><p class="lede">${escapeHtml(listing.summary)}</p><p class="byline">By ${author}</p>${primaryAction}</div>${previews[0] ? `<img src="/sharesets/files/${listing.id}/v${current.number}/${previews[0].id}.png" alt="Preview of ${escapeHtml(listing.title)}" />` : ""}</header>
      <section class="detail-grid"><article class="prose"><h2>About</h2><div class="markdown">${marked.parse(listing.descriptionMarkdown)}</div></article>${metadata ? `<aside><h2>Content</h2><dl>${renderSummary(metadata.content.summary)}</dl><dl><div><dt>File size</dt><dd>${metadata.artifact.byteLength.toLocaleString("en-US")} bytes</dd></div><div><dt>SHA-256</dt><dd class="hash">${escapeHtml(metadata.artifact.sha256)}</dd></div></dl></aside>` : ""}</section>
      ${metadata ? `<section class="detail-grid"><article><h2>Compatibility</h2>${renderCompatibility(metadata)}</article><article><h2>Dependencies</h2>${renderDependencies(metadata)}</article></section>` : ""}
      ${renderReferences(listing.references)}
      ${current ? `<section><h2>Install in PLVS</h2><ol class="steps"><li>Download the current Release file.</li><li>Open PLVS Settings and choose <strong>Import…</strong> in the <strong>Saved Items</strong> row.</li><li>Review what will be added, then confirm the import. Applying or activating the Item is a separate choice.</li></ol></section>` : ""}
      ${previews.length > 0 ? `<section><h2>Previews</h2><div class="preview-grid">${previews.map((preview) => `<figure><img src="/sharesets/files/${listing.id}/v${current.number}/${preview.id}.png" alt="${escapeHtml(previewLabel(preview))}" loading="lazy" /><figcaption>${escapeHtml(previewLabel(preview))}</figcaption></figure>`).join("")}</div></section>` : ""}
      <section><h2>Release history</h2><div class="release-list">${releases}</div></section>
    </main>`
  );
}

async function writePage(path, html) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, html);
}

const SHARESETS_NAVIGATION = /<!-- SHARESETS_NAV_START -->([\s\S]*?)<!-- SHARESETS_NAV_END -->/g;

async function gateSharesetsNavigation(siteDirectory, visible) {
  if (!siteDirectory) return;
  for (const relativePath of [
    "index.html",
    join("docs", "index.html"),
    join("privacy", "index.html"),
  ]) {
    const path = join(siteDirectory, relativePath);
    let html;
    try {
      html = await readFile(path, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    await writeFile(path, html.replace(SHARESETS_NAVIGATION, visible ? "$1" : ""));
  }
}

async function syncSharesetsSiteAssets(siteDirectory, websiteDirectory) {
  if (!siteDirectory) return;
  const target = join(siteDirectory, "assets");
  await mkdir(target, { recursive: true });
  await Promise.all(
    SHARESETS_SITE_ASSETS.map((name) =>
      copyFile(join(websiteDirectory, "assets", name), join(target, name))
    )
  );
}

async function copyReleaseFiles(source, output, listing) {
  const copyRevisions = async (owner, target) => {
    for (const revision of owner.previewRevisions ?? []) {
      const destination = join(target, "previews", `r${revision.number}`);
      await mkdir(destination, { recursive: true });
      for (const preview of revision.previews)
        await copyFile(join(source.root, preview.path), join(destination, `${preview.id}.png`));
    }
  };
  for (const release of listing.releases) {
    const target = join(output, "files", listing.id, `v${release.number}`);
    await mkdir(target, { recursive: true });
    await copyFile(join(source.root, release.artifact), join(target, basename(release.artifact)));
    for (const preview of release.previews) {
      await copyFile(join(source.root, preview.path), join(target, `${preview.id}.png`));
    }
    await copyRevisions(release, target);
  }
  if (listing.included) {
    const target = join(output, "files", listing.id, "included");
    await mkdir(target, { recursive: true });
    for (const preview of listing.included.previews) {
      await copyFile(join(source.root, preview.path), join(target, `${preview.id}.png`));
    }
    await copyRevisions(listing.included, target);
  }
}

export async function buildSharesetsSite({
  contentDirectory,
  outputDirectory,
  siteDirectory,
  websiteDirectory,
} = {}) {
  const source = await readSharesetsSource(contentDirectory ?? resolve("sharesets", "catalogue"));
  const output = resolve(outputDirectory ?? resolve("artifacts", "sharesets-site"));
  const listings = source.listings.map(({ document }) => document);
  for (const listing of listings) {
    const current = latestPublished(listing);
    listing.presetPack =
      listing.type === "presets"
        ? (listing.included?.pack ??
          (current
            ? JSON.parse(await readFile(join(source.root, current.artifact), "utf8"))
            : null))
        : null;
    listing.profile =
      listing.type === "loudness"
        ? (listing.included?.item ??
          (current
            ? JSON.parse(await readFile(join(source.root, current.artifact), "utf8")).items[0]
            : null))
        : null;
  }
  const visibleListings = listings.filter(currentContent);
  await mkdir(output, { recursive: true });
  await writePage(join(output, "index.html"), browsePage(visibleListings));
  for (const type of Object.keys(FAMILIES)) {
    await writePage(join(output, type, "index.html"), browsePage(visibleListings, type));
  }
  for (const listing of listings) {
    await writePage(
      join(output, listing.type, listing.slug, "index.html"),
      detailPage(listing, listing.profile)
    );
    await copyReleaseFiles(source, output, listing);
  }
  const assembledSite = siteDirectory ? resolve(siteDirectory) : null;
  await syncSharesetsSiteAssets(assembledSite, resolve(websiteDirectory ?? "website"));
  await gateSharesetsNavigation(assembledSite, visibleListings.length > 0);
  return {
    outputDirectory: output,
    listingCount: listings.length,
    visibleListingCount: visibleListings.length,
    pageCount: 4 + listings.length,
  };
}

async function main(args) {
  if (args.length > 3)
    throw new Error(
      "Usage: npm run sharesets:site -- [content-directory] [output-directory] [assembled-site-directory]"
    );
  const result = await buildSharesetsSite({
    contentDirectory: args[0],
    outputDirectory: args[1],
    siteDirectory: args[2],
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
