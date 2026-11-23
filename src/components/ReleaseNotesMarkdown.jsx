import { createElement, useMemo } from "react";
import { Marked } from "marked";

const markdown = new Marked({
  gfm: false,
  renderer: {
    html({ text }) {
      return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    },
  },
});

const commonMarkElements = new Set([
  "blockquote",
  "br",
  "code",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul",
]);
const safeProtocol = /^(https?|ircs?|mailto|xmpp)$/i;

/** @param {string | undefined} url */
function safeMarkdownUrl(url) {
  const scheme = url?.match(/^([^/?#:]*):/)?.[1];
  return scheme === undefined || safeProtocol.test(scheme) ? url : undefined;
}

/** @param {{ notes?: string | null, openExternalUrl: (url: string) => unknown }} props */
export function ReleaseNotesMarkdown({ notes, openExternalUrl }) {
  return useMemo(() => {
    // Parse in an inert template and render only CommonMark elements through React.
    // The parser's HTML and attributes never enter the live DOM directly.
    const template = document.createElement("template");
    template.innerHTML = markdown.parse(notes ?? "", { async: false });

    /** @param {ChildNode} node @param {number} key @returns {import("react").ReactNode} */
    function renderNode(node, key) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (!(node instanceof Element)) return null;

      const tag = node.localName;
      const attr = (/** @type {string} */ name) => node.getAttribute(name) ?? undefined;
      if (tag === "img") {
        return (
          <img
            key={key}
            src={safeMarkdownUrl(attr("src"))}
            alt={attr("alt")}
            title={attr("title")}
          />
        );
      }
      const children = Array.from(node.childNodes, renderNode);
      if (tag === "a") {
        const href = safeMarkdownUrl(attr("href"));
        return (
          <a
            key={key}
            href={href}
            onClick={(event) => {
              event.preventDefault();
              if (href) void openExternalUrl(href);
            }}
          >
            {children}
          </a>
        );
      }
      if (!commonMarkElements.has(tag)) return null;
      if (tag === "br" || tag === "hr") return createElement(tag, { key });
      const props =
        tag === "ol"
          ? { start: attr("start") }
          : tag === "code"
            ? { className: attr("class") }
            : {};
      return createElement(tag, { key, ...props }, children);
    }

    return Array.from(template.content.childNodes, renderNode);
  }, [notes, openExternalUrl]);
}
