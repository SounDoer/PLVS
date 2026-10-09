import { describe, expect, it } from "vitest";
import { profilePreview, profileDetails } from "./site-components.mjs";

describe("Profile presentation", () => {
  it("limits summary rules without losing full details or changing threshold semantics", () => {
    const profile = {
      referenceLufs: -23,
      rules: [
        { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
        { metricId: "integrated", op: "<", value: -23.5, severity: "fail" },
        { metricId: "truePeak", op: ">", value: -1, severity: "warn" },
        { metricId: "truePeak", op: ">", value: 0, severity: "fail" },
      ],
    };
    const card = profilePreview(profile);
    expect(card).toContain("1 more rule");
    expect(card).not.toContain("<a ");
    expect(card).not.toContain("&gt; 0 dBTP");
    expect(card).toContain("&lt; −23.5 LUFS → Fail");
    expect(card).toContain("&gt; −1 dBTP → Warn");
    expect(profilePreview(profile, true)).toContain('href="#profile-details"');
    const full = profileDetails(profile);
    expect(full).toContain("&gt; 0 dBTP → Fail");
    expect(full.match(/<dt>Integrated<\/dt>/g)).toHaveLength(1);
    expect(full.match(/<dt>True Peak Max<\/dt>/g)).toHaveLength(1);
  });
  it("handles reference-only and rule-only profiles without inventing values", () => {
    expect(profilePreview({ referenceLufs: -23, rules: [] })).toContain("No rules configured.");
    const ruleOnly = {
      referenceLufs: null,
      rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
    };
    expect(profilePreview(ruleOnly)).toContain("Not Set");
    expect(profileDetails(ruleOnly)).not.toContain("null");
    expect(profilePreview(ruleOnly)).not.toContain("more rule");
  });
});
