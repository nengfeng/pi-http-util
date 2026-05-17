/**
 * whitespace.test.ts — Unit tests for HTML whitespace handling.
 */

import { assert, describe, test } from "./test-harness.ts";
import { runSummary } from "./test-harness.ts";
import {
  isHtmlWhitespace,
  collapseWhitespace,
  collapseWhitespacePreserveLines,
} from "../../.pi/extensions/http_fetch/core.ts";

describe("isHtmlWhitespace()", () => {

  test("regular whitespace", () => {
    assert.equal(isHtmlWhitespace(" "), true);
    assert.equal(isHtmlWhitespace("\t"), true);
    assert.equal(isHtmlWhitespace("\n"), true);
    assert.equal(isHtmlWhitespace("\r"), true);
  });

  test("unicode whitespace", () => {
    assert.equal(isHtmlWhitespace("\u00A0"), true);  // nbsp
    assert.equal(isHtmlWhitespace("\u2002"), true);  // ensp
    assert.equal(isHtmlWhitespace("\u2003"), true);  // emsp
    assert.equal(isHtmlWhitespace("\u2009"), true);  // thinsp
    assert.equal(isHtmlWhitespace("\u200B"), true);  // zwsp
    assert.equal(isHtmlWhitespace("\u00AD"), true);  // soft hyphen
    assert.equal(isHtmlWhitespace("\u202F"), true);  // narrow nb space
    assert.equal(isHtmlWhitespace("\u3000"), true);  // ideographic space
  });

  test("non-whitespace characters", () => {
    assert.equal(isHtmlWhitespace("a"), false);
    assert.equal(isHtmlWhitespace("0"), false);
    assert.equal(isHtmlWhitespace("-"), false);
    assert.equal(isHtmlWhitespace("."), false);
    assert.equal(isHtmlWhitespace("<"), false);
  });
});

describe("collapseWhitespace()", () => {

  test("single space unchanged", () => {
    assert.equal(collapseWhitespace("a b"), "a b");
  });

  test("multiple spaces collapsed to one", () => {
    assert.equal(collapseWhitespace("foo     bar"), "foo bar");
  });

  test("tabs collapsed", () => {
    assert.equal(collapseWhitespace("foo\t\t\tbar"), "foo bar");
  });

  test("newlines collapsed", () => {
    assert.equal(collapseWhitespace("foo\n\n\nbar"), "foo bar");
  });

  test("mixed whitespace collapsed", () => {
    assert.equal(collapseWhitespace("foo \t\n \r bar"), "foo bar");
  });

  test("nbsp collapsed", () => {
    assert.equal(collapseWhitespace("foo\u00A0\u00A0bar"), "foo bar");
  });

  test("nbsp mixed with regular space", () => {
    assert.equal(collapseWhitespace("foo \u00A0 bar"), "foo bar");
  });

  test("leading whitespace collapsed", () => {
    assert.equal(collapseWhitespace("   hello"), " hello");
  });

  test("trailing whitespace collapsed", () => {
    assert.equal(collapseWhitespace("hello   "), "hello ");
  });

  test("no whitespace", () => {
    assert.equal(collapseWhitespace("hello"), "hello");
  });

  test("empty string", () => {
    assert.equal(collapseWhitespace(""), "");
  });

  test("only whitespace", () => {
    assert.equal(collapseWhitespace("   \t\n  "), " ");
  });

  test("nbsp at boundaries", () => {
    assert.equal(collapseWhitespace("\u00A0hello\u00A0"), " hello ");
  });

  test("various unicode whitespace together", () => {
    assert.equal(collapseWhitespace("a\u00A0\u2002\u2003\u2009b"), "a b");
  });

  test("preserves non-whitespace", () => {
    assert.equal(collapseWhitespace("hello-world"), "hello-world");
  });
});

describe("collapseWhitespacePreserveLines()", () => {

  test("preserves single line", () => {
    assert.equal(collapseWhitespacePreserveLines("hello world"), "hello world");
  });

  test("collapses multiple spaces within a line", () => {
    assert.equal(collapseWhitespacePreserveLines("foo     bar"), "foo bar");
  });

  test("preserves single blank line between content", () => {
    assert.equal(collapseWhitespacePreserveLines("foo\n\nbar"), "foo\n\nbar");
  });

  test("collapses multiple consecutive blank lines into one", () => {
    assert.equal(collapseWhitespacePreserveLines("foo\n\n\n\nbar"), "foo\n\nbar");
  });

  test("collapses blank lines that contain only spaces/tabs", () => {
    assert.equal(collapseWhitespacePreserveLines("foo\n\n   \n\t\t\n\nbar"), "foo\n\nbar");
  });

  test("removes leading blank lines", () => {
    assert.equal(collapseWhitespacePreserveLines("\n\n\nhello"), "hello");
  });

  test("removes trailing blank lines", () => {
    assert.equal(collapseWhitespacePreserveLines("hello\n\n\n"), "hello");
  });

  test("removes leading and trailing blank lines", () => {
    assert.equal(collapseWhitespacePreserveLines("\n\nfoo\n\nbar\n\n"), "foo\n\nbar");
  });

  test("trims whitespace on each line", () => {
    assert.equal(collapseWhitespacePreserveLines("  hello  \n  world  "), "hello\nworld");
  });

  test("empty string returns empty string", () => {
    assert.equal(collapseWhitespacePreserveLines(""), "");
  });

  test("only blank lines returns empty string", () => {
    assert.equal(collapseWhitespacePreserveLines("\n\n  \n\n"), "");
  });

  test("preserves multiple content lines", () => {
    const input = "line1\nline2\nline3";
    assert.equal(collapseWhitespacePreserveLines(input), "line1\nline2\nline3");
  });

  test("preserves nbsp as whitespace within lines", () => {
    assert.equal(collapseWhitespacePreserveLines("foo\u00A0\u00A0bar"), "foo bar");
  });

  test("complex multi-line with mixed whitespace", () => {
    const input = "  hello   world  \n\n\n  foo\t\tbaz  \n\n\n\n  end  ";
    const result = collapseWhitespacePreserveLines(input);
    assert.equal(result, "hello world\n\nfoo baz\n\nend");
  });

  test("single blank line between three content sections", () => {
    const input = "a\n\nb\n\nc";
    assert.equal(collapseWhitespacePreserveLines(input), "a\n\nb\n\nc");
  });
});

describe("collapseWhitespace — surrogate pairs", () => {

  test("emoji preserved through collapse", () => {
    const result = collapseWhitespace("hello 😀 world");
    assert.equal(result, "hello 😀 world");
  });

  test("emoji with surrounding whitespace", () => {
    const result = collapseWhitespace("hello   😀   world");
    assert.equal(result, "hello 😀 world");
  });

  test("multiple emoji preserved", () => {
    const result = collapseWhitespace("😀  🎉  🚀");
    assert.equal(result, "😀 🎉 🚀");
  });

  test("CJK characters preserved", () => {
    const result = collapseWhitespace("こんにちは   世界");
    assert.equal(result, "こんにちは 世界");
  });

  test("surrogate pair not split by whitespace check", () => {
    const emoji = "😀";
    assert.equal(emoji.length, 2);
    const result = collapseWhitespace(`a ${emoji} b`);
    assert.equal(result, `a ${emoji} b`);
  });
});


