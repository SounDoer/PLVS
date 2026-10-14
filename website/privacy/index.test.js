import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { policySnapshot, validatePrivacyReview } from "../../scripts/privacy-review.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(currentDir, "index.html"), "utf8");
const review = JSON.parse(readFileSync(join(currentDir, "../../docs/privacy-review.json"), "utf8"));
const deployment = readFileSync(
  join(currentDir, "..", "..", ".github", "workflows", "publish-site.yml"),
  "utf8"
);

describe("Privacy Policy", () => {
  it("matches the reviewed body, links and explicit effective-date decision", () => {
    expect(validatePrivacyReview(html, review)).toEqual([]);
  });
  it("ships at /privacy/ through the complete website builder", () => {
    expect(deployment).toContain("node scripts/build-website.mjs");
    expect(deployment).toContain("path: _site/");
    expect(html).toContain("<title>PLVS Privacy Policy</title>");
  });

  it("protects the core privacy promises from accidental removal", () => {
    expect(html).toContain("never uploads audio samples, audio files, or measurement data");
    expect(html).toContain("checks for updates when the app starts and every 12 hours");
    expect(html).toContain("Subscriber records remain until you request deletion");
    expect(html).toContain("Diagnostics are off by default");
    expect(html).toContain("Nothing is sent until you select <strong>Send</strong>");
    expect(html).toContain("keeps at most the newest five local crash reports");
    expect(html).toContain("xichen@soundoer.com");
  });

  // Page routes include generated Docs and Sharesets pages; website:check validates those
  // against the assembled site. Static assets can also be checked directly in the source tree.
  it("resolves every local stylesheet and image asset", () => {
    const targets = [...html.matchAll(/(?:href|src)="([^"#]+)"/g)]
      .map(([, target]) => target)
      .filter((target) => !/^[a-z]+:/.test(target) && target.includes("/assets/"));
    expect(targets.length).toBeGreaterThan(0);
    const missing = targets.filter((target) => {
      const path = target.startsWith("/")
        ? join(currentDir, "..", target.slice(1))
        : join(currentDir, target);
      return !existsSync(path);
    });

    expect(missing).toEqual([]);
  });
});

describe("privacy review gate", () => {
  const fixture = `<nav>Navigation</nav><main>
    <p class="eyebrow">Effective <time data-policy-effective-date datetime="2026-09-20">September 20, 2026</time></p>
    <h1>Privacy Policy</h1><p>We keep <strong>local</strong> records.</p>
    <p>See <a href="https://example.com/privacy">provider policy</a>.</p>
  </main><footer>Contact</footer>`;
  const record = {
    schemaVersion: 1,
    reviewedOn: "2026-10-14",
    ...policySnapshot(fixture),
    previousEffectiveDate: "2026-09-20",
    dateDecision: "retained",
    changeSummary: "Clarify existing behavior.",
    dateRationale: "No data-handling change.",
    scope: "Example source review.",
    evidence: [{ source: "example.js", revision: "test-fixture", notes: "Reviewed the sender." }],
    limitations: "Source review only.",
  };

  it("ignores chrome, comments, style, inline formatting and whitespace changes", () => {
    const styled = fixture
      .replace("Navigation", "New navigation")
      .replace("Contact", "New footer")
      .replace("<strong>local</strong>", '<span class="new">local</span>')
      .replace("<main>", '<main class="reading"><!-- comment --><style>p {color: red}</style>')
      .replace("We keep", "We\n    keep");
    expect(validatePrivacyReview(styled, record)).toEqual([]);
  });

  it.each([
    ["wording", fixture.replace("local", "remote")],
    ["new paragraph", fixture.replace("</main>", "<p>We collect identifiers.</p></main>")],
    ["deleted section", fixture.replace("<p>We keep <strong>local</strong> records.</p>", "")],
    [
      "destination",
      fixture.replace("https://example.com/privacy", "https://other.example/privacy"),
    ],
  ])("rejects unreviewed %s changes", (_, changed) => {
    expect(validatePrivacyReview(changed, record)).toContain(
      "Policy body or links changed: review the diff and update docs/privacy-review.json."
    );
  });

  it("checks dates separately and accepts a reviewed forward date change", () => {
    const changed = fixture
      .replace("2026-09-20", "2026-10-14")
      .replace("September 20, 2026", "October 14, 2026");
    expect(policySnapshot(changed).contentSha256).toBe(record.contentSha256);
    expect(validatePrivacyReview(changed, record)).toContain(
      "Policy Effective date does not match the review record."
    );
    expect(
      validatePrivacyReview(changed, {
        ...record,
        effectiveDate: "2026-10-14",
        dateDecision: "updated",
      })
    ).toEqual([]);
    expect(validatePrivacyReview(changed, { ...record, effectiveDate: "2026-10-14" })).toContain(
      "A retained date must equal previousEffectiveDate."
    );
    expect(validatePrivacyReview(fixture, { ...record, dateDecision: "updated" })).toContain(
      "An updated date must be later than previousEffectiveDate."
    );
  });

  it.each(["changeSummary", "dateRationale", "scope", "limitations"])("requires %s", (key) => {
    expect(validatePrivacyReview(fixture, { ...record, [key]: " " })).toContain(
      `${key} must explain the review decision.`
    );
  });

  it("rejects missing records, evidence, invalid dates and unsupported schemas", () => {
    expect(validatePrivacyReview(fixture, null).length).toBeGreaterThan(0);
    for (const mutation of [
      { evidence: [] },
      { evidence: [{ source: "file" }] },
      { reviewedOn: "2026-02-30" },
      { previousEffectiveDate: "invalid" },
      { schemaVersion: 2 },
      { dateDecision: "automatic" },
    ]) {
      expect(validatePrivacyReview(fixture, { ...record, ...mutation }).length).toBeGreaterThan(0);
    }
  });

  it("rejects missing or misleading displayed dates and duplicate policy containers", () => {
    for (const changed of [
      fixture.replace("data-policy-effective-date", "data-other"),
      fixture.replace("September 20", "September 21"),
      fixture.replace("2026-09-20", "2026-02-30"),
      fixture + "<main>Extra</main>",
    ]) {
      expect(() => policySnapshot(changed)).toThrow();
    }
  });
});
