import { parse } from "parse5";
import path from "node:path";

export function htmlScripts(
  text: string,
  file: string,
  available: ReadonlySet<string>,
): {
  scripts: string[];
  incomplete: boolean;
} {
  const document = parse(text, { sourceCodeLocationInfo: true });
  const pending = [...document.childNodes];
  const spans: { start: number; end: number }[] = [];
  let incomplete = false;
  while (pending.length) {
    const node = pending.pop()!;
    if ("childNodes" in node)
      for (const child of node.childNodes) pending.push(child);
    if (!("tagName" in node)) continue;
    if (
      node.attrs.some(
        (attr) =>
          /^on/i.test(attr.name) ||
          /^\s*javascript:/i.test(attr.value) ||
          attr.name === "srcdoc",
      )
    )
      incomplete = true;
    if (node.tagName === "base") incomplete = true;
    if (node.tagName !== "script") continue;
    const type = node.attrs
      .find((attr) => attr.name === "type")
      ?.value.toLowerCase()
      .split(";")[0]
      ?.trim();
    if (
      type &&
      !["module", "text/javascript", "application/javascript"].includes(type)
    )
      continue;
    const src = node.attrs.find((attr) => attr.name === "src");
    if (src) {
      // The project walk analyzes local JavaScript; remote dependencies remain opaque.
      const value = src.value.split(/[?#]/)[0]!;
      const local = path.posix.normalize(
        path.posix.join(path.posix.dirname(file.replaceAll("\\", "/")), value),
      );
      if (
        /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value) ||
        ![
          local,
          value.replace(/^\//, ""),
          `public/${value.replace(/^(?:\.\/|\/)/, "")}`,
        ].some(
          (candidate) =>
            available.has(candidate) && /\.[cm]?[jt]sx?$/i.test(candidate),
        )
      )
        incomplete = true;
      continue;
    }
    const location = node.sourceCodeLocation;
    if (!location?.startTag || !location.endTag) {
      incomplete = true;
      continue;
    }
    const start = location.startTag.endOffset;
    spans.push({ start, end: location.endTag.startOffset });
  }
  const chunks: string[] = [];
  let offset = 0;
  for (const span of spans.sort((a, b) => a.start - b.start)) {
    chunks.push(
      text
        .slice(offset, span.start)
        .replace(/[^\r\n]/g, " ")
        .replace(" ", ";"),
      text.slice(span.start, span.end),
    );
    offset = span.end;
  }
  return { scripts: spans.length ? [chunks.join("")] : [], incomplete };
}
