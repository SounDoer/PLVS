import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";

const normalize = (text) => text.replace(/\s+/gu, " ").trim();
const blockTags = new Set([
  "MAIN",
  "SECTION",
  "DIV",
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "DL",
  "DT",
  "DD",
  "BLOCKQUOTE",
  "PRE",
  "TABLE",
  "TR",
  "TH",
  "TD",
  "BR",
]);

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function policyText(node) {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.nodeType !== 1 || ["SCRIPT", "STYLE"].includes(node.tagName)) return "";
  if (node.tagName === "IMG") return ` ${node.getAttribute("alt") ?? ""} `;
  const text = [...node.childNodes].map(policyText).join("");
  return blockTags.has(node.tagName) ? ` ${text} ` : text;
}

// Snapshot only the policy, not navigation, footer, CSS or inline presentation markup.
// Link destinations are included: changing a recipient/provider URL requires review too.
export function policySnapshot(html) {
  const dom = new JSDOM(html, { url: "https://plvs.soundoer.com/privacy/" });
  try {
    const mains = dom.window.document.querySelectorAll("main");
    if (mains.length !== 1) throw new Error("Privacy page must contain exactly one main element.");
    const main = mains[0];
    const dates = main.querySelectorAll("time[data-policy-effective-date]");
    if (dates.length !== 1) throw new Error("Privacy page must contain one policy effective date.");
    const time = dates[0];
    const effectiveDate = time.getAttribute("datetime");
    if (!validDate(effectiveDate))
      throw new Error("Policy effective date must be a valid ISO date.");
    const displayDate = new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${effectiveDate}T00:00:00Z`));
    if (
      normalize(time.textContent) !== displayDate ||
      normalize(time.parentElement.textContent) !== `Effective ${displayDate}`
    ) {
      throw new Error("Visible Effective date must match its datetime value.");
    }
    time.parentElement.remove();
    const text = normalize(policyText(main));
    if (!text) throw new Error("Privacy policy body must not be empty.");
    const links = [...main.querySelectorAll("a[href]")].map((link) => link.href);
    const contentSha256 = createHash("sha256")
      .update(JSON.stringify({ text, links }))
      .digest("hex");
    return { effectiveDate, contentSha256 };
  } finally {
    dom.window.close();
  }
}

export function validatePrivacyReview(html, record) {
  const snapshot = policySnapshot(html);
  const errors = [];
  if (record?.schemaVersion !== 1) errors.push("Review schemaVersion must be 1.");
  for (const key of ["reviewedOn", "effectiveDate", "previousEffectiveDate"]) {
    if (!validDate(record?.[key])) errors.push(`${key} must be a valid ISO date.`);
  }
  for (const key of ["changeSummary", "dateRationale", "scope", "limitations"]) {
    if (typeof record?.[key] !== "string" || !record[key].trim()) {
      errors.push(`${key} must explain the review decision.`);
    }
  }
  if (
    !Array.isArray(record?.evidence) ||
    !record.evidence.length ||
    record.evidence.some((entry) =>
      ["source", "revision", "notes"].some(
        (key) => typeof entry?.[key] !== "string" || !entry[key].trim()
      )
    )
  )
    errors.push("Evidence must identify source, revision and notes for each reviewed source.");
  if (record?.contentSha256 !== snapshot.contentSha256) {
    errors.push(
      "Policy body or links changed: review the diff and update docs/privacy-review.json."
    );
  }
  if (record?.effectiveDate !== snapshot.effectiveDate) {
    errors.push("Policy Effective date does not match the review record.");
  }
  if (record?.dateDecision === "retained") {
    if (record.effectiveDate !== record.previousEffectiveDate) {
      errors.push("A retained date must equal previousEffectiveDate.");
    }
  } else if (record?.dateDecision === "updated") {
    if (record.effectiveDate <= record.previousEffectiveDate) {
      errors.push("An updated date must be later than previousEffectiveDate.");
    }
  } else errors.push("dateDecision must be retained or updated.");
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const mode = process.argv[2] ?? "check";
    if (!["check", "snapshot"].includes(mode) || process.argv.length > 3) {
      throw new Error("Usage: node scripts/privacy-review.mjs [check|snapshot]");
    }
    const html = readFileSync("website/privacy/index.html", "utf8");
    if (mode === "snapshot") {
      console.log(JSON.stringify(policySnapshot(html), null, 2));
    } else {
      const record = JSON.parse(readFileSync("docs/privacy-review.json", "utf8"));
      const errors = validatePrivacyReview(html, record);
      if (errors.length) throw new Error(errors.join("\n"));
      console.log(
        "Privacy review record matches the policy. Semantic release review is still required."
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
