import { escapeHtml } from "../http/richText";

/** Geometry-only SVG, used as an inert image, never injected as DOM markup. */
export function sanitizeDiagramSvg(svg: string): string {
  // Draw.io exports HTML labels in foreignObject. Reduce labels to inert SVG
  // text rather than allowing foreign HTML or losing the entire diagram.
  if (/<(?:script|iframe|object|embed|style)\b/iu.test(svg))
    throw new Error("Unsupported active SVG diagram.");
  svg = svg.replace(
    /<foreignObject\b([^>]*)>([\s\S]*?)<\/foreignObject\s*>/giu,
    (_whole, attrs: string, content: string) => {
      const coordinate = (name: string) => {
        const value = Number.parseFloat(
          new RegExp("\\b" + name + "=[\"']([^\"']+)[\"']", "iu").exec(
            attrs,
          )?.[1] ?? "0",
        );
        return Number.isFinite(value) ? value : 0;
      };
      const text = content
        .replace(/<[^>]*>/gu, " ")
        .replace(/&nbsp;/gu, " ")
        .replace(/&amp;/gu, "&")
        .replace(/\s+/gu, " ")
        .trim();
      return `<text x="${coordinate("x") + 4}" y="${coordinate("y") + 16}" font-size="14">${escapeHtml(text)}</text>`;
    },
  );
  if (
    !/<svg\b/iu.test(svg) ||
    /<!DOCTYPE|<!ENTITY|<(?:script|foreignObject|iframe|object|embed|image|use|style|animate\w*|set)\b/iu.test(
      svg,
    )
  )
    throw new Error("Unsupported active SVG diagram.");
  const tags = new Set([
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "defs",
    "lineargradient",
    "radialgradient",
    "stop",
    "clippath",
    "marker",
    "title",
    "desc",
  ]);
  const names: Record<string, string> = {
    lineargradient: "linearGradient",
    radialgradient: "radialGradient",
    clippath: "clipPath",
  };
  const attributes = new Set([
    "id",
    "x",
    "y",
    "x1",
    "x2",
    "y1",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "width",
    "height",
    "viewBox",
    "d",
    "points",
    "transform",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-dasharray",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "font-size",
    "font-family",
    "font-weight",
    "text-anchor",
    "dominant-baseline",
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientUnits",
    "gradientTransform",
    "clip-path",
    "marker-start",
    "marker-end",
    "markerWidth",
    "markerHeight",
    "refX",
    "refY",
    "orient",
    "preserveAspectRatio",
  ]);
  const tokens =
    svg
      .replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/gu, "")
      .match(/<[^>]*>|[^<]+/gu) ?? [];
  return tokens
    .map((token) => {
      if (!token.startsWith("<"))
        return token.replace(
          /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/giu,
          "&amp;",
        );
      const match = /^<\s*(\/)?([a-z][a-z0-9]*)\b([^>]*)>$/iu.exec(token);
      if (!match) return "";
      const lower = match[2]?.toLowerCase() ?? "";
      if (!tags.has(lower)) return "";
      const tag = names[lower] ?? lower;
      if (match[1]) return `</${tag}>`;
      const attrs: string[] =
        lower === "svg" ? ['xmlns="http://www.w3.org/2000/svg"'] : [];
      for (const attribute of (match[3] ?? "").matchAll(
        /([a-z][a-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/giu,
      )) {
        const name = attribute[1] ?? "";
        const value = attribute[2] ?? attribute[3] ?? "";
        if (
          !attributes.has(name) ||
          /[<>\0]/u.test(value) ||
          /(?:https?:|data:|javascript:|\/\/)/iu.test(value) ||
          (/url\s*\(/iu.test(value) && !/^url\(#[a-z0-9_-]+\)$/iu.test(value))
        )
          continue;
        attrs.push(`${name}="${escapeHtml(value)}"`);
      }
      return `<${tag} ${attrs.join(" ")}${/\/\s*>$/u.test(token) ? "/" : ""}>`;
    })
    .join("");
}

export function mediaDataUrl(bytes: Uint8Array, contentType: string): string {
  const type = contentType.split(";")[0]?.trim().toLowerCase();
  const data = Buffer.from(bytes);
  if (type === "image/svg+xml")
    return `data:image/svg+xml;base64,${Buffer.from(sanitizeDiagramSvg(data.toString("utf8"))).toString("base64")}`;
  const valid =
    type === "image/png"
      ? data
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : type === "image/jpeg"
        ? data[0] === 255 && data[1] === 216 && data[2] === 255
        : type === "image/gif"
          ? /^GIF8[79]a/u.test(data.subarray(0, 6).toString())
          : type === "image/webp"
            ? data.subarray(0, 4).toString() === "RIFF" &&
              data.subarray(8, 12).toString() === "WEBP"
            : false;
  if (!valid) throw new Error("Unsupported or invalid image format.");
  return `data:${type};base64,${data.toString("base64")}`;
}
