import { isAbsolute } from "node:path";
import { marked } from "marked";

export const COMMUNITY_LISTING_SCHEMA_VERSION = 1;

const TYPES = new Set(["loudness", "presets", "themes"]);
const CLASSIFICATIONS = new Set(["official", "community"]);
const RELEASE_STATUSES = new Set(["published", "withdrawn"]);
const EXTENSIONS = {
  loudness: ".plvsloudness",
  presets: ".plvspreset",
  themes: ".plvstheme",
};
const LISTING_FIELDS = new Set([
  "schemaVersion",
  "id",
  "slug",
  "type",
  "classification",
  "title",
  "summary",
  "descriptionMarkdown",
  "tags",
  "author",
  "releases",
]);
const AUTHOR_FIELDS = new Set(["name", "url"]);
const RELEASE_FIELDS = new Set([
  "number",
  "publishedAt",
  "status",
  "notesMarkdown",
  "artifact",
  "previews",
  "withdrawalReason",
]);
const PREVIEW_FIELDS = new Set(["id", "path"]);

export class CommunityRecordError extends Error {
  constructor(issues) {
    super("The Community Listing record is invalid.");
    this.name = "CommunityRecordError";
    this.code = "invalidCommunityRecord";
    this.issues = issues;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function issue(code, path, message, details) {
  return { severity: "error", code, path, message, ...(details ? { details } : {}) };
}

function unknownFields(raw, allowed, path, issues) {
  if (!isPlainObject(raw)) return;
  for (const field of Object.keys(raw)) {
    if (!allowed.has(field)) {
      issues.push(issue("unknownRecordField", `${path}.${field}`, `Unknown field: ${field}.`));
    }
  }
}

function normalizedText(value, { path, label, max, singleLine = true }, issues) {
  if (typeof value !== "string") {
    issues.push(issue("invalidText", path, `${label} must be text.`));
    return "";
  }
  const normalized = value.trim();
  if (normalized.length === 0) issues.push(issue("emptyText", path, `${label} cannot be empty.`));
  if (singleLine && /[\r\n]/.test(value)) {
    issues.push(issue("multilineText", path, `${label} must stay on one line.`));
  }
  if (/\p{Cc}/u.test(normalized)) {
    issues.push(issue("controlCharacter", path, `${label} cannot contain control characters.`));
  }
  if (Array.from(normalized).length > max) {
    issues.push(issue("textTooLong", path, `${label} must contain at most ${max} characters.`));
  }
  return normalized;
}

function safeRelativePath(value, extension = null) {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value)) return false;
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    return false;
  }
  return extension === null || normalized.toLowerCase().endsWith(extension);
}

function markdownIssues(value, path, label, issues) {
  const markdown = normalizedText(value, { path, label, max: 10000, singleLine: false }, issues);
  if (!markdown) return markdown;
  const visit = (tokens) => {
    for (const token of tokens ?? []) {
      if (token.type === "html") {
        issues.push(issue("rawHtmlNotAllowed", path, `${label} cannot contain raw HTML.`));
      }
      if (token.type === "link" && !/^https:\/\//i.test(token.href ?? "")) {
        issues.push(
          issue("unsafeMarkdownLink", path, `${label} links must use an explicit HTTPS URL.`, {
            href: token.href,
          })
        );
      }
      if (Array.isArray(token.tokens)) visit(token.tokens);
      if (Array.isArray(token.items)) {
        for (const item of token.items) visit(item.tokens);
      }
    }
  };
  visit(marked.lexer(markdown));
  return markdown;
}

function validateAuthor(raw, issues) {
  if (raw == null) return null;
  if (!isPlainObject(raw)) {
    issues.push(issue("invalidAuthor", "$.author", "author must be null or an object."));
    return null;
  }
  unknownFields(raw, AUTHOR_FIELDS, "$.author", issues);
  const name = normalizedText(
    raw.name,
    { path: "$.author.name", label: "Author name", max: 80 },
    issues
  );
  let url = null;
  if (raw.url != null) {
    if (typeof raw.url !== "string" || !/^https:\/\/[^\s]+$/i.test(raw.url)) {
      issues.push(issue("invalidAuthorUrl", "$.author.url", "Author URL must use HTTPS."));
    } else {
      url = raw.url;
    }
  }
  return { name, url };
}

function validateTags(raw, issues) {
  if (!Array.isArray(raw)) {
    issues.push(issue("invalidTags", "$.tags", "tags must be an array."));
    return [];
  }
  if (raw.length > 20) {
    issues.push(issue("tooManyTags", "$.tags", "A Listing may have at most 20 tags."));
  }
  const seen = new Set();
  const tags = [];
  raw.forEach((value, index) => {
    const path = `$.tags[${index}]`;
    const tag = normalizedText(value, { path, label: "Tag", max: 32 }, issues);
    const key = tag.normalize("NFKC").toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      issues.push(issue("duplicateTag", path, `Duplicate tag: ${tag}.`));
      return;
    }
    seen.add(key);
    tags.push(tag);
  });
  return tags;
}

function validatePreviews(raw, releasePath, issues) {
  if (!Array.isArray(raw)) {
    issues.push(issue("invalidPreviews", `${releasePath}.previews`, "previews must be an array."));
    return [];
  }
  const seen = new Set();
  return raw.map((preview, index) => {
    const path = `${releasePath}.previews[${index}]`;
    if (!isPlainObject(preview)) {
      issues.push(issue("invalidPreview", path, "Each preview must be an object."));
      return { id: "", path: "" };
    }
    unknownFields(preview, PREVIEW_FIELDS, path, issues);
    const id = normalizedText(
      preview.id,
      { path: `${path}.id`, label: "Preview ID", max: 80 },
      issues
    );
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      issues.push(
        issue(
          "invalidPreviewId",
          `${path}.id`,
          "Preview IDs use lowercase letters, numbers, and hyphens."
        )
      );
    }
    if (seen.has(id)) {
      issues.push(issue("duplicatePreviewId", `${path}.id`, `Duplicate preview ID: ${id}.`));
    }
    seen.add(id);
    if (!safeRelativePath(preview.path, ".png")) {
      issues.push(
        issue(
          "invalidPreviewPath",
          `${path}.path`,
          "Preview paths must be safe relative .png paths."
        )
      );
    }
    return {
      id,
      path: typeof preview.path === "string" ? preview.path.replaceAll("\\", "/") : "",
    };
  });
}

function validateRelease(raw, index, type, issues) {
  const path = `$.releases[${index}]`;
  if (!isPlainObject(raw)) {
    issues.push(issue("invalidRelease", path, "Each Release must be an object."));
    return null;
  }
  unknownFields(raw, RELEASE_FIELDS, path, issues);
  if (!Number.isSafeInteger(raw.number) || raw.number < 1) {
    issues.push(
      issue("invalidReleaseNumber", `${path}.number`, "Release number must be a positive integer.")
    );
  }
  if (typeof raw.publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.publishedAt)) {
    issues.push(
      issue("invalidPublishedDate", `${path}.publishedAt`, "publishedAt must use YYYY-MM-DD.")
    );
  } else if (Number.isNaN(Date.parse(`${raw.publishedAt}T00:00:00Z`))) {
    issues.push(
      issue("invalidPublishedDate", `${path}.publishedAt`, "publishedAt must be a real date.")
    );
  }
  if (!RELEASE_STATUSES.has(raw.status)) {
    issues.push(
      issue("invalidReleaseStatus", `${path}.status`, "status must be published or withdrawn.")
    );
  }
  if (!safeRelativePath(raw.artifact, EXTENSIONS[type])) {
    issues.push(
      issue(
        "invalidArtifactPath",
        `${path}.artifact`,
        `artifact must be a safe relative ${EXTENSIONS[type]} path.`
      )
    );
  }
  const notesMarkdown = markdownIssues(
    raw.notesMarkdown,
    `${path}.notesMarkdown`,
    "Release notes",
    issues
  );
  const previews = validatePreviews(raw.previews, path, issues);
  let withdrawalReason = null;
  if (raw.status === "withdrawn") {
    withdrawalReason = normalizedText(
      raw.withdrawalReason,
      { path: `${path}.withdrawalReason`, label: "Withdrawal reason", max: 240 },
      issues
    );
  } else if (raw.withdrawalReason != null) {
    issues.push(
      issue(
        "unexpectedWithdrawalReason",
        `${path}.withdrawalReason`,
        "Only a withdrawn Release may have a withdrawal reason."
      )
    );
  }
  return {
    number: raw.number,
    publishedAt: raw.publishedAt,
    status: raw.status,
    notesMarkdown,
    artifact: typeof raw.artifact === "string" ? raw.artifact.replaceAll("\\", "/") : "",
    previews,
    withdrawalReason,
  };
}

export function validateCommunityListingRecord(raw) {
  const issues = [];
  if (!isPlainObject(raw)) {
    throw new CommunityRecordError([
      issue("invalidListing", "$", "A Community Listing must be a plain object."),
    ]);
  }
  unknownFields(raw, LISTING_FIELDS, "$", issues);
  if (raw.schemaVersion !== COMMUNITY_LISTING_SCHEMA_VERSION) {
    issues.push(
      issue(
        "unsupportedListingSchemaVersion",
        "$.schemaVersion",
        `schemaVersion must be ${COMMUNITY_LISTING_SCHEMA_VERSION}.`
      )
    );
  }
  const id = normalizedText(raw.id, { path: "$.id", label: "Listing ID", max: 128 }, issues);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    issues.push(issue("invalidListingId", "$.id", "Listing ID has an invalid format."));
  }
  const slug = normalizedText(raw.slug, { path: "$.slug", label: "Slug", max: 128 }, issues);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    issues.push(
      issue("invalidListingSlug", "$.slug", "Slug must use lowercase words separated by hyphens.")
    );
  }
  if (!TYPES.has(raw.type)) {
    issues.push(issue("invalidListingType", "$.type", "Unknown Item type."));
  }
  if (!CLASSIFICATIONS.has(raw.classification)) {
    issues.push(
      issue(
        "invalidClassification",
        "$.classification",
        "classification must be official or community."
      )
    );
  }
  const title = normalizedText(raw.title, { path: "$.title", label: "Title", max: 120 }, issues);
  const summary = normalizedText(
    raw.summary,
    { path: "$.summary", label: "Summary", max: 240 },
    issues
  );
  const descriptionMarkdown = markdownIssues(
    raw.descriptionMarkdown,
    "$.descriptionMarkdown",
    "Description",
    issues
  );
  const tags = validateTags(raw.tags, issues);
  const author = validateAuthor(raw.author, issues);
  if (!Array.isArray(raw.releases) || raw.releases.length === 0) {
    issues.push(issue("invalidReleases", "$.releases", "A Listing needs at least one Release."));
  }
  const releases = (Array.isArray(raw.releases) ? raw.releases : [])
    .map((release, index) => validateRelease(release, index, raw.type, issues))
    .filter(Boolean);
  const numbers = new Set();
  releases.forEach((release, index) => {
    if (numbers.has(release.number)) {
      issues.push(
        issue(
          "duplicateReleaseNumber",
          `$.releases[${index}].number`,
          `Duplicate Release ${release.number}.`
        )
      );
    }
    numbers.add(release.number);
    if (index > 0 && release.number <= releases[index - 1].number) {
      issues.push(
        issue(
          "releaseOrder",
          `$.releases[${index}].number`,
          "Releases must be ordered by increasing number."
        )
      );
    }
  });

  if (issues.length > 0) throw new CommunityRecordError(issues);
  return {
    schemaVersion: COMMUNITY_LISTING_SCHEMA_VERSION,
    id,
    slug,
    type: raw.type,
    classification: raw.classification,
    title,
    summary,
    descriptionMarkdown,
    tags,
    author,
    releases,
  };
}
