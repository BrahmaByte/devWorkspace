/** Small ADF fallback when Jira does not provide renderedFields.description. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

export function formatJiraDescription(value: unknown): string {
  if (typeof value === "string")
    return value
      .split(/\n\s*\n/u)
      .map((part) => `<p>${escapeHtml(part).replace(/\n/gu, "<br>")}</p>`)
      .join("");
  let visited = 0;
  const visit = (node: unknown, depth: number): string => {
    if (
      ++visited > 10000 ||
      depth > 40 ||
      typeof node !== "object" ||
      !node ||
      Array.isArray(node)
    )
      return "";
    const item = node as Record<string, unknown>;
    const children = Array.isArray(item.content)
      ? item.content.map((child) => visit(child, depth + 1)).join("")
      : "";
    const attrs =
      typeof item.attrs === "object" && item.attrs
        ? (item.attrs as Record<string, unknown>)
        : {};
    if (item.type === "text" && typeof item.text === "string") {
      let text = escapeHtml(item.text);
      if (Array.isArray(item.marks))
        for (const mark of item.marks) {
          if (typeof mark !== "object" || !mark) continue;
          const tag = (
            {
              strong: "strong",
              em: "em",
              code: "code",
              strike: "del",
              underline: "u",
            } as Record<string, string>
          )[(mark as Record<string, unknown>).type as string];
          if (tag) text = `<${tag}>${text}</${tag}>`;
        }
      return text;
    }
    if (item.type === "hardBreak") return "<br>";
    if (item.type === "rule") return "<hr>";
    if (item.type === "heading") {
      const level =
        typeof attrs.level === "number" && attrs.level >= 1 && attrs.level <= 6
          ? attrs.level
          : 2;
      return `<h${level}>${children}</h${level}>`;
    }
    if (item.type === "codeBlock") return `<pre><code>${children}</code></pre>`;
    const tag = (
      {
        paragraph: "p",
        bulletList: "ul",
        orderedList: "ol",
        listItem: "li",
        blockquote: "blockquote",
        table: "table",
        tableRow: "tr",
        tableCell: "td",
        tableHeader: "th",
      } as Record<string, string>
    )[item.type as string];
    if (tag) return `<${tag}>${children}</${tag}>`;
    if (item.type === "mention")
      return escapeHtml(
        typeof attrs.text === "string" ? attrs.text : "Mention",
      );
    return children;
  };
  return visit(value, 0);
}
