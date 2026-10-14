/**
 * Unwrap source-formatted list prose for GitHub Releases, whose renderer displays
 * soft newlines. Keep this dependency-free: release validation runs before npm ci.
 * Only join adjacent prose at the list item's content indentation; leave other
 * Markdown blocks and explicit hard breaks alone.
 */
export function unwrapReleaseListProse(markdown) {
  const output = [];
  let contentIndent = null;
  let fence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      output.push(line);
      if (new RegExp(`^${fence.char}{${fence.length},}\\s*$`).test(trimmed)) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
      contentIndent = null;
      output.push(line);
      continue;
    }
    const item = line.match(/^( *)(?:[-+*]|\d+[.)]) +(?=\S)/);
    const block = /^(?:#{1,6}(?:\s|$)|>|<|\| |\[[^\]]+\]:|(?:[-*_] *){3,}$)/.test(trimmed);
    if (item && !block) {
      contentIndent = item[0].length;
    } else if (
      contentIndent !== null &&
      line.length - trimmed.length === contentIndent &&
      trimmed &&
      !block
    ) {
      const previous = output.at(-1);
      const backslashes = previous.match(/\\+$/)?.[0].length ?? 0;
      if (!/ {2,}$/.test(previous) && backslashes % 2 === 0) {
        output[output.length - 1] += ` ${trimmed}`;
        continue;
      }
    } else {
      contentIndent = null;
    }
    output.push(line);
  }
  return output.join("\n");
}
