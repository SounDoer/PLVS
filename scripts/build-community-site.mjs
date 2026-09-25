import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { marked } from "marked";
import { readCommunitySource } from "./community-catalogue-source.mjs";

const FAMILIES = {
  loudness: { label: "Loudness Profiles", singular: "Loudness Profile" },
  presets: { label: "Presets", singular: "Preset" },
  themes: { label: "Themes", singular: "Theme" },
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function page(title, description, body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="stylesheet" href="/assets/community.css" />
    <script type="module" src="/assets/community.js"></script>
  </head>
  <body>
    <nav class="nav" aria-label="Main navigation">
      <a class="brand" href="/"><img src="/assets/app-icon.svg" alt="" />PLVS</a>
      <div class="nav-links"><a href="/community/" aria-current="page">Community</a><a href="/docs/">Docs</a><a href="https://github.com/SounDoer/PLVS">GitHub</a></div>
    </nav>
    ${body}
    <footer><span>PLVS Community</span><a href="/">Back to PLVS</a></footer>
  </body>
</html>
`;
}

function typeNav(active = null) {
  return `<nav class="family-nav" aria-label="Community categories">
    <a href="/community/"${active === null ? ' aria-current="page"' : ""}>All</a>
    ${Object.entries(FAMILIES)
      .map(
        ([type, family]) =>
          `<a href="/community/${type}/"${active === type ? ' aria-current="page"' : ""}>${family.label}</a>`
      )
      .join("\n    ")}
  </nav>`;
}

function latestPublished(listing) {
  return [...listing.releases].reverse().find(({ status }) => status === "published") ?? null;
}

function card(listing) {
  const release = latestPublished(listing);
  const facets = release?.metadata.facets ?? {};
  const preview = release?.previews[0];
  const previewUrl = preview
    ? `/community/files/${listing.id}/v${release.number}/${preview.id}.png`
    : null;
  const searchText = [listing.title, listing.summary, listing.descriptionMarkdown, ...listing.tags]
    .join(" ")
    .toLocaleLowerCase("en-US");
  const attributes = {
    search: searchText,
    type: listing.type,
    module: (facets.moduleIds ?? []).join("|"),
    metric: (facets.metricIds ?? []).join("|"),
    scheme: facets.themeScheme ?? "",
    feature: (facets.optionalCapabilities ?? []).join("|"),
    dependency: (facets.dependencyIds ?? []).join("|"),
  };
  return `<article class="card" ${Object.entries(attributes)
    .map(([key, value]) => `data-${key}="${escapeHtml(value)}"`)
    .join(" ")}>
    <a class="card-media" href="/community/${listing.type}/${listing.slug}/" aria-label="View ${escapeHtml(listing.title)}">
      ${previewUrl ? `<img src="${escapeHtml(previewUrl)}" alt="" loading="lazy" />` : `<span>${FAMILIES[listing.type].singular}</span>`}
    </a>
    <div class="card-body">
      <div class="meta"><span>${FAMILIES[listing.type].singular}</span><span>${escapeHtml(listing.classification)}</span></div>
      <h2><a href="/community/${listing.type}/${listing.slug}/">${escapeHtml(listing.title)}</a></h2>
      <p>${escapeHtml(listing.summary)}</p>
      <div class="tags">${listing.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
    </div>
  </article>`;
}

function facetValues(listings, key) {
  return [
    ...new Set(
      listings.flatMap((listing) => {
        const value = latestPublished(listing)?.metadata.facets?.[key];
        return Array.isArray(value) ? value : value ? [value] : [];
      })
    ),
  ].sort((left, right) => left.localeCompare(right, "en-US"));
}

function selectFilter(name, label, values) {
  return `<label><span>${label}</span><select data-catalogue-filter="${name}"><option value="">All</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}</select></label>`;
}

function browseControls(listings, activeType) {
  return `<form class="browse-controls" data-catalogue-controls>
    <label class="search"><span>Search</span><input type="search" data-catalogue-search placeholder="Search Community" /></label>
    ${activeType === null ? selectFilter("type", "Type", Object.keys(FAMILIES)) : ""}
    ${selectFilter("module", "Module", facetValues(listings, "moduleIds"))}
    ${selectFilter("metric", "Metric", facetValues(listings, "metricIds"))}
    ${selectFilter("scheme", "Theme Scheme", facetValues(listings, "themeScheme"))}
    ${selectFilter("feature", "Feature", facetValues(listings, "optionalCapabilities"))}
    ${selectFilter("dependency", "Dependency", facetValues(listings, "dependencyIds"))}
    <button type="reset">Clear</button>
  </form>`;
}

function browsePage(listings, activeType = null) {
  const visible = activeType ? listings.filter(({ type }) => type === activeType) : listings;
  const title = activeType ? FAMILIES[activeType].label : "Community Catalogue";
  const intro = activeType
    ? `Browse curated ${FAMILIES[activeType].label.toLowerCase()} for PLVS.`
    : "Curated Loudness Profiles, Presets, and Themes for PLVS.";
  return page(
    `${title} — PLVS`,
    intro,
    `<main class="catalogue">
      <header class="hero"><p class="eyebrow">PLVS Community</p><h1>${title}</h1><p>${intro}</p></header>
      ${typeNav(activeType)}
      ${browseControls(visible, activeType)}
      ${
        visible.length > 0
          ? `<section class="card-grid" data-catalogue-grid aria-label="${escapeHtml(title)}">${visible.map(card).join("\n")}</section><section class="empty" data-catalogue-empty hidden aria-live="polite"><h2>No matching Items</h2><p>Try clearing one or more filters.</p></section>`
          : `<section class="empty"><h2>Nothing published yet</h2><p>The catalogue structure is ready. Curated releases will appear here after validation.</p></section>`
      }
    </main>`
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
  return `<ul class="dependency-list">${metadata.dependencies.map((dependency) => `<li><strong>${escapeHtml(dependency.name)}</strong><span>${escapeHtml(dependency.kind)} · ${escapeHtml(dependency.id)}</span></li>`).join("")}</ul>`;
}

function detailPage(listing) {
  const current = latestPublished(listing);
  const metadata = current?.metadata;
  const previews = current?.previews ?? [];
  const author = listing.author
    ? listing.author.url
      ? `<a href="${escapeHtml(listing.author.url)}" rel="author noopener">${escapeHtml(listing.author.name)}</a>`
      : escapeHtml(listing.author.name)
    : "PLVS curators";
  const currentDownload = current
    ? `/community/files/${listing.id}/v${current.number}/${basename(current.artifact)}`
    : null;
  const primaryAction = current
    ? listing.type === "themes"
      ? `<div class="actions"><button class="button" type="button" data-copy-artifact="${currentDownload}">Copy Theme</button><a class="button secondary" href="${currentDownload}" download>Download .plvstheme</a><span class="copy-status" data-copy-status aria-live="polite"></span></div>`
      : `<a class="button" href="${currentDownload}" download>Download Release ${current.number}</a>`
    : "";
  const releases = [...listing.releases]
    .reverse()
    .map((release) => {
      const download = `/community/files/${listing.id}/v${release.number}/${basename(release.artifact)}`;
      return `<article class="release">
        <div><h3>Release ${release.number}</h3><p>${escapeHtml(release.publishedAt)} · ${escapeHtml(release.status)}</p></div>
        <div class="markdown">${marked.parse(release.notesMarkdown)}</div>
        ${release.status === "published" ? `<a class="button secondary" href="${download}" download>Download</a>` : `<p class="withdrawn">Withdrawn: ${escapeHtml(release.withdrawalReason)}</p>`}
      </article>`;
    })
    .join("\n");
  return page(
    `${listing.title} — PLVS Community`,
    listing.summary,
    `<main class="detail">
      <p class="breadcrumb"><a href="/community/">Community</a> / <a href="/community/${listing.type}/">${FAMILIES[listing.type].label}</a></p>
      <header class="detail-hero"><div><p class="eyebrow">${FAMILIES[listing.type].singular} · ${escapeHtml(listing.classification)}</p><h1>${escapeHtml(listing.title)}</h1><p class="lede">${escapeHtml(listing.summary)}</p><p class="byline">By ${author}</p>${primaryAction}</div>${previews[0] ? `<img src="/community/files/${listing.id}/v${current.number}/${previews[0].id}.png" alt="Preview of ${escapeHtml(listing.title)}" />` : ""}</header>
      <section class="detail-grid"><article class="prose"><h2>About</h2><div class="markdown">${marked.parse(listing.descriptionMarkdown)}</div></article>${metadata ? `<aside><h2>Content</h2><dl>${renderSummary(metadata.content.summary)}</dl><dl><div><dt>File size</dt><dd>${metadata.artifact.byteLength.toLocaleString("en-US")} bytes</dd></div><div><dt>SHA-256</dt><dd class="hash">${escapeHtml(metadata.artifact.sha256)}</dd></div></dl></aside>` : ""}</section>
      ${metadata ? `<section class="detail-grid"><article><h2>Compatibility</h2>${renderCompatibility(metadata)}</article><article><h2>Dependencies</h2>${renderDependencies(metadata)}</article></section>` : ""}
      ${current ? `<section><h2>Install in PLVS</h2><ol class="steps"><li>Download the current Release file.</li><li>Open PLVS Settings and choose <strong>Import Shared Item…</strong>.</li><li>Review what will be added, then confirm the import. Applying or activating the Item is a separate choice.</li></ol></section>` : ""}
      ${previews.length > 0 ? `<section><h2>Previews</h2><div class="preview-grid">${previews.map((preview) => `<figure><img src="/community/files/${listing.id}/v${current.number}/${preview.id}.png" alt="${escapeHtml(preview.id.replaceAll("-", " "))}" loading="lazy" /><figcaption>${escapeHtml(preview.id.replaceAll("-", " "))}</figcaption></figure>`).join("")}</div></section>` : ""}
      <section><h2>Release history</h2><div class="release-list">${releases}</div></section>
    </main>`
  );
}

async function writePage(path, html) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, html);
}

const COMMUNITY_NAVIGATION = /<!-- COMMUNITY_NAV_START -->([\s\S]*?)<!-- COMMUNITY_NAV_END -->/g;

async function gateCommunityNavigation(siteDirectory, visible) {
  if (!siteDirectory) return;
  for (const relativePath of ["index.html", join("docs", "index.html")]) {
    const path = join(siteDirectory, relativePath);
    let html;
    try {
      html = await readFile(path, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    await writeFile(path, html.replace(COMMUNITY_NAVIGATION, visible ? "$1" : ""));
  }
}

async function copyReleaseFiles(source, output, listing) {
  for (const release of listing.releases) {
    const target = join(output, "files", listing.id, `v${release.number}`);
    await mkdir(target, { recursive: true });
    await copyFile(join(source.root, release.artifact), join(target, basename(release.artifact)));
    for (const preview of release.previews) {
      await copyFile(join(source.root, preview.path), join(target, `${preview.id}.png`));
    }
  }
}

export async function buildCommunitySite({
  contentDirectory,
  outputDirectory,
  siteDirectory,
} = {}) {
  const source = await readCommunitySource(contentDirectory ?? resolve("community", "catalogue"));
  const output = resolve(outputDirectory ?? resolve("artifacts", "community-site"));
  const listings = source.listings.map(({ document }) => document);
  const visibleListings = listings.filter(latestPublished);
  await mkdir(output, { recursive: true });
  await writePage(join(output, "index.html"), browsePage(visibleListings));
  for (const type of Object.keys(FAMILIES)) {
    await writePage(join(output, type, "index.html"), browsePage(visibleListings, type));
  }
  for (const listing of listings) {
    await writePage(join(output, listing.type, listing.slug, "index.html"), detailPage(listing));
    await copyReleaseFiles(source, output, listing);
  }
  await gateCommunityNavigation(
    siteDirectory ? resolve(siteDirectory) : null,
    visibleListings.length > 0
  );
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
      "Usage: npm run community:site -- [content-directory] [output-directory] [assembled-site-directory]"
    );
  const result = await buildCommunitySite({
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
