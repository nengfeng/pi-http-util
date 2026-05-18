/**
 * tokenizer.test.ts — Unit tests for the HTML tokenizer.
 */

import { assert, describe, test, collectTokens } from "./test-harness.ts";
import { runSummary } from "./test-harness.ts";

describe("tokenize()", () => {

  test("plain text produces a single text token", () => {
    const tokens = collectTokens("hello world");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].kind, "text");
    assert.equal(tokens[0].data, "hello world");
  });

  test("simple opening tag", () => {
    const tokens = collectTokens("<div>");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].kind, "tag");
    assert.equal(tokens[0].name, "div");
    assert.equal(tokens[0].selfClosing, false);
    assert.equal(tokens[0].attributes.length, 0);
  });

  test("closing tag", () => {
    const tokens = collectTokens("</div>");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].kind, "tag");
    assert.equal(tokens[0].name, "div");
    assert.equal(tokens[0].selfClosing, false);
  });

  test("self-closing tag", () => {
    const tokens = collectTokens("<br/>");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].kind, "tag");
    assert.equal(tokens[0].name, "br");
    assert.equal(tokens[0].selfClosing, true);
  });

  test("self-closing tag without slash", () => {
    const tokens = collectTokens("<br>");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].kind, "tag");
    assert.equal(tokens[0].name, "br");
    assert.equal(tokens[0].selfClosing, false);
  });

  test("tag with double-quoted attribute", () => {
    const tokens = collectTokens('<div class="foo bar" id="main">');
    assert.equal(tokens.length, 1);
    const tag = tokens[0] as { kind: "tag"; attributes: Array<{ name: string; value: string | null }> };
    assert.equal(tag.attributes.length, 2);
    assert.equal(tag.attributes[0].name, "class");
    assert.equal(tag.attributes[0].value, "foo bar");
    assert.equal(tag.attributes[1].name, "id");
    assert.equal(tag.attributes[1].value, "main");
  });

  test("tag with single-quoted attribute", () => {
    const tokens = collectTokens("<div class='foo'>");
    assert.equal(tokens.length, 1);
    const tag = tokens[0] as { kind: "tag"; attributes: Array<{ name: string; value: string | null }> };
    assert.equal(tag.attributes[0].value, "foo");
  });

  test("tag with unquoted attribute", () => {
    const tokens = collectTokens("<div class=foo>");
    assert.equal(tokens.length, 1);
    const tag = tokens[0] as { kind: "tag"; attributes: Array<{ name: string; value: string | null }> };
    assert.equal(tag.attributes[0].value, "foo");
  });

  test("tag with boolean attribute (no value)", () => {
    const tokens = collectTokens("<input disabled>");
    assert.equal(tokens.length, 1);
    const tag = tokens[0] as { kind: "tag"; attributes: Array<{ name: string; value: string | null }> };
    assert.equal(tag.attributes[0].name, "disabled");
    assert.equal(tag.attributes[0].value, null);
  });

  test("mixed content: text + tags + text", () => {
    const tokens = collectTokens("Hello <b>world</b>!");
    assert.equal(tokens.length, 5);
    assert.equal(tokens[0].kind, "text");
    assert.equal(tokens[0].data, "Hello ");
    assert.equal(tokens[1].kind, "tag");
    assert.equal(tokens[1].name, "b");
    assert.equal(tokens[2].kind, "text");
    assert.equal(tokens[2].data, "world");
    assert.equal(tokens[3].kind, "tag");
    assert.equal(tokens[3].name, "b");
    assert.equal(tokens[4].kind, "text");
    assert.equal(tokens[4].data, "!");
  });

  test("HTML comment", () => {
    const tokens = collectTokens("before<!-- some comment -->after");
    assert.equal(tokens.length, 3);
    assert.equal(tokens[0].kind, "text");
    assert.equal(tokens[0].data, "before");
    assert.equal(tokens[1].kind, "comment");
    assert.equal(tokens[1].data, " some comment ");
    assert.equal(tokens[2].kind, "text");
    assert.equal(tokens[2].data, "after");
  });

  test("DOCTYPE", () => {
    const tokens = collectTokens("<!DOCTYPE html>");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].kind, "doctype");
    assert.equal(tokens[0].data, " html");
  });

  test("empty input produces no tokens", () => {
    const tokens = collectTokens("");
    assert.equal(tokens.length, 0);
  });

  test("tag names are lowercased", () => {
    const tokens = collectTokens("<DIV CLASS='X'>");
    assert.equal(tokens[0].kind, "tag");
    assert.equal(tokens[0].name, "div");
  });

  test("attribute values with quotes inside", () => {
    const tokens = collectTokens('<a title="he said \'hi\'">');
    assert.equal(tokens.length, 1);
    const tag = tokens[0] as { kind: "tag"; attributes: Array<{ name: string; value: string | null }> };
    assert.equal(tag.attributes[0].value, "he said 'hi'");
  });

  test("multiple attributes with mixed quoting", () => {
    const tokens = collectTokens('<img src="photo.jpg" alt=\'A photo\' width=200 />');
    assert.equal(tokens.length, 1);
    const tag = tokens[0] as { kind: "tag"; attributes: Array<{ name: string; value: string | null }> };
    assert.equal(tag.attributes.length, 3);
    assert.equal(tag.attributes[0].value, "photo.jpg");
    assert.equal(tag.attributes[1].value, "A photo");
    assert.equal(tag.attributes[2].value, "200");
    assert.equal(tag.selfClosing, true);
  });

  test("newline in attribute value", () => {
    const tokens = collectTokens('<div data-x="line1\nline2">');
    assert.equal(tokens.length, 1);
    const tag = tokens[0] as { kind: "tag"; attributes: Array<{ name: string; value: string | null }> };
    assert.equal(tag.attributes[0].value, "line1\nline2");
  });

  test("complex HTML document structure", () => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head><title>Test</title></head>
<body><!-- main content --><p>Hello</p></body>
</html>`;
    const tokens = collectTokens(html);
    const kinds = tokens.map(t => t.kind);
    assert(kinds.includes("doctype"));
    assert(kinds.includes("comment"));
    assert(kinds.filter(k => k === "tag").length > 5);
  });
});

describe("tokenize() — edge cases", () => {

  test("unclosed tag degrades to text", () => {
    const tokens = collectTokens("<div hello");
    assert(tokens.length >= 1);
  });

  test("angle bracket in text (not a tag)", () => {
    const tokens = collectTokens("5 < 10");
    assert(tokens.length >= 2);
    assert.equal(tokens[0].kind, "text");
    assert.equal(tokens[0].data, "5 ");
  });

  test("malformed comment (no closing) yields text", () => {
    const tokens = collectTokens("<!-- unclosed comment");
    assert(tokens.length >= 1);
    assert.equal(tokens[0].kind, "text");
  });

  test("nested quotes in attribute value", () => {
    const tokens = collectTokens('<div data-x="<script>alert(1)</script>">');
    assert.equal(tokens.length, 1);
    const tag = tokens[0] as { kind: "tag"; attributes: Array<{ name: string; value: string | null }> };
    assert.equal(tag.attributes[0].name, "data-x");
    assert.equal(tag.attributes[0].value, "<script>alert(1)</script>");
  });

  test("unclosed attribute quote consumes to end of string", () => {
    const tokens = collectTokens('<div class="hello');
    assert(tokens.length, 1);
    const tag = tokens[0] as { kind: "tag"; attributes: Array<{ name: string; value: string | null }> };
    assert.equal(tag.attributes[0].value, "hello");
  });

  test("tag with only whitespace inside", () => {
    const tokens = collectTokens("<div>   </div>");
    assert.equal(tokens.length, 3);
    assert.equal(tokens[0].kind, "tag");
    assert.equal(tokens[1].kind, "text");
    assert.equal(tokens[1].data, "   ");
    assert.equal(tokens[2].kind, "tag");
  });

  test("consecutive tags with no text between", () => {
    const tokens = collectTokens("<div><span><p>");
    assert.equal(tokens.length, 3);
    assert.equal(tokens[0].kind, "tag");
    assert.equal(tokens[1].kind, "tag");
    assert.equal(tokens[2].kind, "tag");
  });

  test("single < at end of input", () => {
    const tokens = collectTokens("hello <");
    assert(tokens.length >= 1);
    const last = tokens[tokens.length - 1];
    assert.equal(last.kind, "text");
    assert.equal(last.data, "<");
  });

  test("<br> and </br> both handled", () => {
    const tokens1 = collectTokens("<br>");
    assert.equal(tokens1[0].kind, "tag");
    assert.equal((tokens1[0] as any).name, "br");

    const tokens2 = collectTokens("</br>");
    assert.equal(tokens2[0].kind, "tag");
    assert.equal((tokens2[0] as any).name, "br");
    assert.equal((tokens2[0] as any).isClosing, true);
  });
});


