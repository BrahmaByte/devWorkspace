import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatJiraDescription } from "../../src/infrastructure/http/richText";
import {
  sanitizeDiagramSvg,
  mediaDataUrl,
} from "../../src/infrastructure/confluence/readerMedia";

void describe("Provider rich content", () => {
  void it("preserves ADF headings, marks, lists, code and tables without active markup", () => {
    const html = formatJiraDescription({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Plan" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Safe", marks: [{ type: "strong" }] },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "codeBlock",
          content: [{ type: "text", text: '<script>alert("fake")</script>' }],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Column" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    assert.match(html, /<h2>Plan<\/h2>/u);
    assert.match(html, /<ul><li><p><strong>Safe<\/strong>/u);
    assert.match(html, /<pre><code>&lt;script&gt;/u);
    assert.match(html, /<table><tr><th>/u);
    assert.doesNotMatch(html, /<script>/u);
    assert.equal(
      formatJiraDescription("First\nline\n\nSecond"),
      "<p>First<br>line</p><p>Second</p>",
    );
  });
  void it("keeps SVG geometry but strips events, styles and external references", () => {
    const svg = sanitizeDiagramSvg(
      '<svg viewBox="0 0 100 60" onload="steal()"><rect width="100" height="60" fill="blue"/><path d="M0 0L10 10" style="background:url(https://evil.test)"/><text x="5" y="20">Diagram</text></svg>',
    );
    assert.match(svg, /viewBox="0 0 100 60"/u);
    assert.match(svg, /<rect/u);
    assert.doesNotMatch(svg, /onload|steal|style|evil/iu);
    assert.match(
      mediaDataUrl(Buffer.from(svg), "image/svg+xml"),
      /^data:image\/svg\+xml;base64,/u,
    );
    for (const active of [
      "<script>alert(1)</script>",
      '<image href="https://evil.test"/>',
      '<use href="https://evil.test"/>',
    ])
      assert.throws(() => sanitizeDiagramSvg("<svg>" + active + "</svg>"));
    const labels = sanitizeDiagramSvg(
      '<svg><foreignObject x="5" y="10"><div onclick="steal()">Architecture label</div></foreignObject></svg>',
    );
    assert.match(labels, /<text x="9" y="26"/u);
    assert.match(labels, /Architecture label/u);
    assert.doesNotMatch(labels, /foreignObject|onclick|steal/u);
    assert.throws(() =>
      mediaDataUrl(Buffer.from("<html>login</html>"), "image/png"),
    );
  });
});
