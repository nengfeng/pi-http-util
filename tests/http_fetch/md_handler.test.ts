/**
 * md_handler.test.ts — Tests for the SAX-style HTML-to-Markdown handler.
 */

import { assert, describe, test } from "./test-harness.ts";
import { emitEvents } from "../../.pi/extensions/http_fetch/md_emitter.ts";
import { processEvents } from "../../.pi/extensions/http_fetch/md_handler.ts";

function toMd(html: string): string {
  return processEvents(emitEvents(html));
}

describe("processEvents() — headings", () => {

  test("h1-h6", () => {
    assert(toMd("<h1>Title</h1>").includes("# Title"));
    assert(toMd("<h2>Section</h2>").includes("## Section"));
    assert(toMd("<h3>Sub</h3>").includes("### Sub"));
    assert(toMd("<h6>Small</h6>").includes("###### Small"));
  });

  test("multiple headings with content", () => {
    const result = toMd("<h1>Title</h1><p>Content</p><h2>Sub</h2><p>More</p>");
    assert(result.includes("# Title"));
    assert(result.includes("Content"));
    assert(result.includes("## Sub"));
    assert(result.includes("More"));
  });
});

describe("processEvents() — bold / italic / strikethrough", () => {

  test("bold / strong", () => {
    assert(toMd("<p><b>bold</b></p>").includes("**bold**"));
    assert(toMd("<p><strong>strong</strong></p>").includes("**strong**"));
  });

  test("italic / em", () => {
    assert(toMd("<p><i>italic</i></p>").includes("*italic*"));
    assert(toMd("<p><em>emphasized</em></p>").includes("*emphasized*"));
  });

  test("strikethrough", () => {
    assert(toMd("<s>old</s>").includes("~~old~~"));
    assert(toMd("<strike>old</strike>").includes("~~old~~"));
    assert(toMd("<del>old</del>").includes("~~old~~"));
  });

  test("nested inline formatting", () => {
    const result = toMd("<p><b><i>bold italic</i></b></p>");
    assert(result.includes("**bold italic**"));
  });
});

describe("processEvents() — code", () => {

  test("inline code", () => {
    assert(toMd("Use the <code>code</code> tag").includes("`code`"));
  });

  test("code block (pre)", () => {
    const result = toMd("<pre><code>function hello() { return 42; }</code></pre>");
    assert(result.includes("```"));
    assert(result.includes("function hello()"));
  });

  test("pre without code tag", () => {
    const result = toMd("<pre>plain text\nline 2</pre>");
    assert(result.includes("```"));
    assert(result.includes("plain text"));
    assert(result.includes("line 2"));
  });

  test("code block preserves whitespace", () => {
    const result = toMd("<pre>  indented\n    more indented</pre>");
    assert(result.includes("  indented"));
    assert(result.includes("    more indented"));
  });
});

describe("processEvents() — links and images", () => {

  test("links", () => {
    const result = toMd('<a href="https://example.com">click here</a>');
    assert(result.includes("[click here](https://example.com)"));
  });

  test("images", () => {
    const result = toMd('<img src="photo.jpg" alt="A photo">');
    assert(result.includes("![A photo](photo.jpg)"));
  });

  test("img alt with brackets escaped", () => {
    const result = toMd('<img src="x.jpg" alt="[bracket]">');
    assert(result.includes("!["));
    assert(result.includes("](x.jpg)"));
  });

  test("link without href is ignored", () => {
    const result = toMd("<a name='anchor'>not a link</a>");
    assert(result.includes("not a link"));
    assert(!result.includes("[not a link]"));
  });
});

describe("processEvents() — lists", () => {

  test("unordered list", () => {
    const result = toMd("<ul><li>One</li><li>Two</li><li>Three</li></ul>");
    assert(result.includes("- One"));
    assert(result.includes("- Two"));
    assert(result.includes("- Three"));
  });

  test("ordered list", () => {
    const result = toMd("<ol><li>First</li><li>Second</li></ol>");
    assert(result.includes("1. First"));
    assert(result.includes("1. Second"));
  });

  test("nested lists", () => {
    const result = toMd(
      "<ul><li>Item 1<ul><li>Sub A</li><li>Sub B</li></ul></li><li>Item 2</li></ul>"
    );
    assert(result.includes("- Item 1"));
    assert(result.includes("- Sub A"));
    assert(result.includes("- Sub B"));
    assert(result.includes("- Item 2"));
  });
});

describe("processEvents() — blockquote", () => {

  test("simple blockquote", () => {
    const result = toMd("<blockquote><p>Quote text</p></blockquote>");
    assert(result.includes("> Quote text"));
  });

  test("nested blockquotes", () => {
    const result = toMd(
      "<blockquote><p>Outer <blockquote><p>Inner</p></blockquote></p></blockquote>"
    );
    assert(result.includes("> Outer"));
    assert(result.includes("> Inner"));
  });
});

describe("processEvents() — tables", () => {

  test("table with header and row", () => {
    const result = toMd(
      '<table><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr></table>'
    );
    assert(result.includes("| Name"));
    assert(result.includes("| Age"));
    assert(result.includes("| Alice"));
    assert(result.includes("| 30"));
    assert(result.includes("---"));
  });

  test("empty table", () => {
    const result = toMd("<table></table>");
    assert(typeof result === "string");
  });

  test("table with single cell", () => {
    assert(toMd("<table><tr><td>one</td></tr></table>").includes("| one"));
  });
});

describe("processEvents() — paragraphs and breaks", () => {

  test("paragraphs separated", () => {
    const result = toMd("<p>First</p><p>Second</p>");
    assert(result.includes("First"));
    assert(result.includes("Second"));
  });

  test("br becomes line break", () => {
    const result = toMd("Line one<br>Line two");
    assert(result.includes("Line one"));
    assert(result.includes("Line two"));
  });

  test("horizontal rule", () => {
    const result = toMd("<p>Before</p><hr><p>After</p>");
    assert(result.includes("---"));
  });

  test("multiple hr in a row", () => {
    assert(toMd("<hr><hr><hr>").includes("---"));
  });
});

describe("processEvents() — skip elements", () => {

  test("skips script content", () => {
    const result = toMd("<p>Text</p><script>alert('xss')</script><p>More</p>");
    assert(result.includes("Text"));
    assert(result.includes("More"));
    assert(!result.includes("alert"));
    assert(!result.includes("xss"));
  });

  test("skips style content", () => {
    const result = toMd("<p>Text</p><style>.foo { color: red; }</style><p>More</p>");
    assert(result.includes("Text"));
    assert(result.includes("More"));
    assert(!result.includes("color"));
  });

  test("skips head/meta/title", () => {
    const result = toMd(
      "<!DOCTYPE html><html><head><title>Test</title><meta charset='utf-8'></head><body><p>Content</p></body></html>"
    );
    assert(result.includes("Content"));
    assert(!result.includes("Test"));
  });

  test("noscript content skipped", () => {
    const result = toMd("<p>Visible</p><noscript>Hidden</noscript><p>Also visible</p>");
    assert(result.includes("Visible"));
    assert(result.includes("Also visible"));
    assert(!result.includes("Hidden"));
  });

  test("template content skipped", () => {
    const result = toMd("<p>Before</p><template><p>hidden</p></template><p>After</p>");
    assert(result.includes("Before"));
    assert(result.includes("After"));
    assert(!result.includes("hidden"));
  });

  test("slot content skipped", () => {
    const result = toMd("<p>Before</p><slot>fallback</slot><p>After</p>");
    assert(result.includes("Before"));
    assert(result.includes("After"));
    assert(!result.includes("fallback"));
  });
});

describe("processEvents() — inline formatting extras", () => {

  test("sub tag", () => {
    assert(toMd("H<sub>2</sub>O").includes("H~2~O"));
  });

  test("sup tag", () => {
    assert(toMd("x<sup>2</sup>").includes("x^2^"));
  });

  test("q tag (inline quote)", () => {
    assert(toMd('<p>Said <q>hello</q> to me</p>').includes('"hello"'));
  });

  test("abbr tag without title", () => {
    assert(toMd("<abbr>HTML</abbr> is great").includes("HTML"));
  });

  test("abbr tag with title", () => {
    const result = toMd('<abbr title="HyperText Markup Language">HTML</abbr>');
    assert(result.includes("HTML"));
    assert(result.includes("HyperText Markup Language"));
  });

  test("mark tag (highlight)", () => {
    assert(toMd("<p>Important: <mark>read this</mark></p>").includes("==read this=="));
  });
});

describe("processEvents() — entity decoding", () => {

  test("entity decoding in markdown", () => {
    const result = toMd("<p>1 &lt; 2 &amp;&amp; 3 &gt; 0</p>");
    assert(result.includes("1 < 2 && 3 > 0"));
  });

  test("emoji in content preserved", () => {
    assert(toMd("<p>Hello 😀 world</p>").includes("Hello 😀 world"));
  });
});

describe("processEvents() — edge cases", () => {

  test("empty input", () => {
    assert.equal(toMd(""), "");
  });

  test("plain text passthrough", () => {
    assert.equal(toMd("just plain text"), "just plain text");
  });

  test("closing void element tags ignored", () => {
    const result = toMd("<p>Before</p></br><p>After</p>");
    assert(result.includes("Before"));
    assert(result.includes("After"));
  });

  test("unclosed inline tags — markers flushed at end", () => {
    assert(toMd("<p><b>bold text").includes("**bold text**"));
  });

  test("malformed HTML with text between broken tags", () => {
    const result = toMd("<p>hello<div>world<p>goodbye");
    assert(result.includes("hello"));
    assert(result.includes("world"));
    assert(result.includes("goodbye"));
  });

  test("div creates block separation", () => {
    const result = toMd("<div>Section 1</div><div>Section 2</div>");
    assert(result.includes("Section 1"));
    assert(result.includes("Section 2"));
  });

  test("unknown elements treated as blocks", () => {
    const result = toMd("<foo>content1</foo><bar>content2</bar>");
    assert(result.includes("content1"));
    assert(result.includes("content2"));
  });

  test("list inside blockquote", () => {
    const result = toMd("<blockquote><ul><li>Item</li></ul></blockquote>");
    assert(result.includes(">"));
    assert(result.includes("- Item"));
  });

  test("nested script blocks", () => {
    const result = toMd(
      "<p>before</p><script><script>nested</script>after</script><p>end</p>"
    );
    assert(result.includes("before"));
    assert(result.includes("end"));
    assert(!result.includes("nested"));
  });

  test("consecutive divs produce single blank line between sections", () => {
    const result = toMd("<div>Section 1</div><div>Section 2</div>");
    const lines = result.split("\n");
    // Should have exactly one blank line between sections
    const blankCount = lines.filter(l => l.trim() === "").length;
    assert(blankCount <= 1, `Expected at most 1 blank line, got ${blankCount}: ${JSON.stringify(result)}`);
  });

  test("nested divs do not produce excessive blank lines", () => {
    const result = toMd(
      "<div><div><div><div>Deep content</div></div></div></div>"
    );
    const lines = result.split("\n");
    const blankCount = lines.filter(l => l.trim() === "").length;
    assert(blankCount <= 1, `Expected at most 1 blank line for nested divs, got ${blankCount}: ${JSON.stringify(result)}`);
  });

  test("nested divs with content produce clean output", () => {
    const result = toMd(
      `<div class="page">
  <div class="container">
    <div class="content">
      <p>Article text</p>
    </div>
  </div>
</div>`
    );
    assert(result.includes("Article text"));
    const lines = result.split("\n");
    const blankCount = lines.filter(l => l.trim() === "").length;
    assert(blankCount <= 1, `Expected at most 1 blank line, got ${blankCount}: ${JSON.stringify(result)}`);
  });

  test("consecutive paragraphs produce single blank line", () => {
    const result = toMd("<p>First</p><p>Second</p><p>Third</p>");
    const lines = result.split("\n");
    const blankCount = lines.filter(l => l.trim() === "").length;
    assert(blankCount <= 2, `Expected at most 2 blank lines for 3 paragraphs, got ${blankCount}: ${JSON.stringify(result)}`);
  });

  test("no leading or trailing blank lines in output", () => {
    const result = toMd("<div><p>Content</p></div>");
    assert(!result.startsWith("\n"), "Should not start with blank line");
    assert(!result.endsWith("\n"), "Should not end with blank line");
  });

  test("unknown block elements produce clean separation", () => {
    const result = toMd("<section><article>Post</article></section>");
    assert(result.includes("Post"));
    const lines = result.split("\n");
    const blankCount = lines.filter(l => l.trim() === "").length;
    assert(blankCount <= 1, `Expected at most 1 blank line, got ${blankCount}: ${JSON.stringify(result)}`);
  });
});

describe("processEvents() — complex document", () => {

  test("complex document to markdown", () => {
    const input = `<!DOCTYPE html>
<html>
<head><title>My Page</title></head>
<body>
  <h1>Welcome</h1>
  <p>This is a <strong>great</strong> page with <a href="/link">a link</a>.</p>
  <h2>Features</h2>
  <ul>
    <li>Fast</li>
    <li>Reliable
      <ul>
        <li>99.9% uptime</li>
      </ul>
    </li>
  </ul>
  <blockquote><p>As they say, <em>quality</em> matters.</p></blockquote>
  <pre><code>const x = 42;</code></pre>
  <hr>
  <p>Copyright &copy; 2024</p>
</body>
</html>`;
    const result = toMd(input);
    assert(result.includes("# Welcome"));
    assert(result.includes("**great**"));
    assert(result.includes("[a link](/link)"));
    assert(result.includes("## Features"));
    assert(result.includes("- Fast"));
    assert(result.includes("- Reliable"));
    assert(result.includes("99.9% uptime"));
    assert(result.includes("> As they say"));
    assert(result.includes("*quality*"));
    assert(result.includes("```"));
    assert(result.includes("const x = 42"));
    assert(result.includes("---"));
    assert(result.includes("Copyright"));
    assert(result.includes("\u00A9"));
    assert(!result.includes("<html"));
    assert(!result.includes("<body"));
  });
});

describe("processEvents() — details/summary", () => {

  test("details with summary", () => {
    const result = toMd("<details><summary>Click me</summary><p>Hidden content</p></details>");
    assert(result.includes("Click me"));
    assert(result.includes("Hidden content"));
  });
});

describe("processEvents() — figure/figcaption", () => {

  test("figure with figcaption", () => {
    const result = toMd(
      '<figure><img src="photo.jpg" alt="A photo"><figcaption>A nice photo</figcaption></figure>'
    );
    assert(result.includes("![A photo](photo.jpg)"));
    assert(result.includes("A nice photo"));
  });
});

describe("processEvents() — time", () => {

  test("time with datetime", () => {
    const result = toMd('<time datetime="2024-01-01">New Year</time>');
    assert(result.includes("New Year"));
    assert(result.includes("2024-01-01"));
  });

  test("time without datetime", () => {
    const result = toMd("<time>Some date</time>");
    assert(result.includes("Some date"));
  });
});

describe("processEvents() — picture/source", () => {

  test("picture with source and img", () => {
    const result = toMd(
      '<picture><source srcset="large.jpg"><img src="small.jpg" alt="Responsive"></picture>'
    );
    assert(result.includes("![Responsive](large.jpg)"));
  });

  test("picture with only img", () => {
    const result = toMd('<picture><img src="only.jpg" alt="Only"></picture>');
    assert(result.includes("![Only](only.jpg)"));
  });
});
