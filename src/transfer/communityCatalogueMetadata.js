import { hashPortableLoudnessProfile } from "../lib/portableLoudnessProfile.js";
import { buildCommunityThemePreviewPlan } from "../theme/communityThemePreview.js";
import { hashPortableTheme } from "../theme/portableTheme.js";
import { validateCommunityArtifactText } from "./communityArtifact.js";
import { validatePublishablePack } from "./communityPack.js";
import { buildCommunityPreviewPlan } from "./communityPreview.js";
import { hashPortablePreset } from "./portablePreset.js";

export const COMMUNITY_CATALOGUE_METADATA_VERSION = 1;

async function itemHash(type, document) {
  if (type === "loudness") return hashPortableLoudnessProfile(document);
  if (type === "presets") return hashPortablePreset(document);
  return hashPortableTheme(document);
}

function contentSummary(type, document) {
  if (type === "loudness") {
    return {
      referenceLufs: document.referenceLufs,
      ruleCount: document.rules.length,
      metricIds: [...new Set(document.rules.map(({ metricId }) => metricId))].sort(),
    };
  }
  if (type === "presets") {
    return {
      workspacePanelCount: document.workspace.panels.length,
      dockEnabled: document.dock.enabled,
      dockPanelCount: document.dock.enabled ? document.dock.panels.length : 0,
    };
  }
  return { colorScheme: document.colorScheme };
}

function systemFacets(type, document, compatibility = {}) {
  return {
    itemType: type,
    moduleIds: compatibility.moduleIds ?? [],
    metricIds: compatibility.metricIds ?? [],
    themeScheme: type === "themes" ? document.colorScheme : null,
    dependencyIds: compatibility.dependencyIds ?? [],
    optionalCapabilities: compatibility.optionalCapabilities ?? [],
  };
}

function compactPreviewPlan(type, plan) {
  if (type === "themes") {
    return {
      contractVersion: plan.contractVersion,
      renderer: { name: plan.generator, version: plan.contractVersion },
      fixture: null,
      assets: plan.assets.map(({ id, kind, renderer, sceneId, format }) => ({
        id,
        kind,
        renderer,
        ...(sceneId ? { sceneId } : {}),
        format,
      })),
    };
  }
  return {
    contractVersion: plan.contractVersion,
    renderer: { name: plan.renderer.name, version: plan.renderer.version },
    fixture: {
      id: plan.fixture.id,
      version: plan.fixture.version,
      sha256: plan.fixtureHash,
    },
    assets: plan.assets.map(({ id, renderer, surface, format, viewport }) => ({
      id,
      renderer,
      surface,
      format,
      viewport,
    })),
  };
}

/**
 * Derives only machine-owned Catalogue fields. Listing copy, author identity, tags, licence, and
 * release notes are intentionally absent because none of them are facts contained in a Pack.
 */
export async function deriveCommunityCatalogueMetadata(text, { fileName } = {}) {
  const validation = await validateCommunityArtifactText(text, { fileName });
  const rawPack = JSON.parse(text);
  const publication = validatePublishablePack(rawPack, validation.type);
  const document = publication.portableItem;
  const contentHash = await itemHash(validation.type, document);
  const previewPlan =
    validation.type === "themes"
      ? await buildCommunityThemePreviewPlan({ theme: document })
      : await buildCommunityPreviewPlan(rawPack, validation.type);

  const dependencies =
    validation.type === "presets"
      ? await Promise.all(
          (rawPack.dependencies?.[0]?.items ?? []).map(async ({ id, ...dependency }) => ({
            id,
            kind: dependency.kind,
            name: dependency.name,
            formatVersion: dependency.formatVersion,
            semanticsVersion: dependency.semanticsVersion,
            contentHash: await hashPortableLoudnessProfile(dependency),
          }))
        )
      : [];

  return {
    metadataVersion: COMMUNITY_CATALOGUE_METADATA_VERSION,
    content: {
      type: validation.type,
      title: document.name,
      itemId: validation.primaryItem.id,
      itemKind: document.kind,
      formatVersion: document.formatVersion,
      semanticsVersion: document.semanticsVersion,
      contentHash,
      summary: contentSummary(validation.type, document),
    },
    artifact: validation.artifact,
    dependencies,
    compatibility: publication.assessment.compatibility ?? {},
    facets: systemFacets(validation.type, document, publication.assessment.compatibility),
    preview: compactPreviewPlan(validation.type, previewPlan),
  };
}
