/**
 * ESLint plugin: guardrails for ADR 0002 (no Tailwind `dark:` palette axis in app code).
 * shadcn primitives under `src/components/ui/` are allow-listed.
 */

/** @param {string} fp */
function isShadcnUiPath(fp) {
  const n = fp.replace(/\\/g, "/");
  return n.includes("/src/components/ui/");
}

/** @type {import("eslint").Rule.RuleModule} */
const noTailwindDarkPaletteVariant = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow Tailwind `dark:` variant in app chrome (use semantic tokens / data-theme).",
    },
    schema: [],
    messages: {
      noDarkVariant:
        "Do not use Tailwind `dark:` for theming (ADR 0002). Prefer semantic classes and `applyThemeToDocument`.",
    },
  },
  create(context) {
    if (isShadcnUiPath(context.filename)) {
      return {};
    }
    /** @param {string|undefined} val @param {import("estree").Node} node */
    function check(val, node) {
      if (typeof val !== "string" || !val.includes("dark:")) return;
      context.report({ node, messageId: "noDarkVariant" });
    }
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node.value, node);
      },
      TemplateElement(node) {
        const v = node.value.cooked ?? node.value.raw;
        check(v, node);
      },
    };
  },
};

/** @type {import("eslint").ESLint.Plugin} */
const plugin = {
  meta: { name: "plvs-adr-theme", version: "0.0.0" },
  rules: {
    "no-tailwind-dark-palette-variant": noTailwindDarkPaletteVariant,
  },
};

export default plugin;
