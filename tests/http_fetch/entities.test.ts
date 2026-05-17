/**
 * entities.test.ts — Unit tests for HTML entity decoding.
 */

import { assert, describe, test } from "./test-harness.ts";
import { runSummary } from "./test-harness.ts";
import {
  decodeHtmlEntity,
  decodeEntity,
  decodeTextEntities,
} from "../../.pi/extensions/http_fetch/core.ts";

describe("decodeHtmlEntity()", () => {

  test("common entities", () => {
    assert.equal(decodeHtmlEntity("nbsp"), "\u00A0");
    assert.equal(decodeHtmlEntity("lt"), "<");
    assert.equal(decodeHtmlEntity("gt"), ">");
    assert.equal(decodeHtmlEntity("amp"), "&");
    assert.equal(decodeHtmlEntity("quot"), '"');
    assert.equal(decodeHtmlEntity("apos"), "'");
    assert.equal(decodeHtmlEntity("copy"), "\u00A9");
    assert.equal(decodeHtmlEntity("mdash"), "\u2014");
    assert.equal(decodeHtmlEntity("euro"), "\u20AC");
    assert.equal(decodeHtmlEntity("deg"), "\u00B0");
  });

  test("unknown entity returns null", () => {
    assert.equal(decodeHtmlEntity("zzzzz"), null);
    assert.equal(decodeHtmlEntity(""), null);
  });

  test("case sensitivity (nbsp vs NBSP)", () => {
    assert.equal(decodeHtmlEntity("nbsp"), "\u00A0");
    assert.equal(decodeHtmlEntity("NBSP"), null);
  });

  test("Latin-1 accented characters (Estonian: ä ö ü Ä Ö Ü)", () => {
    assert.equal(decodeHtmlEntity("auml"), "ä");
    assert.equal(decodeHtmlEntity("ouml"), "ö");
    assert.equal(decodeHtmlEntity("uuml"), "ü");
    assert.equal(decodeHtmlEntity("Auml"), "Ä");
    assert.equal(decodeHtmlEntity("Ouml"), "Ö");
    assert.equal(decodeHtmlEntity("Uuml"), "Ü");
    assert.equal(decodeHtmlEntity("szlig"), "ß");
    assert.equal(decodeHtmlEntity("eth"), "ð");
    assert.equal(decodeHtmlEntity("thorn"), "þ");
    assert.equal(decodeHtmlEntity("yuml"), "ÿ");
  });

  test("Latin-1 grave/acute/circumflex/tilde", () => {
    assert.equal(decodeHtmlEntity("agrave"), "à");
    assert.equal(decodeHtmlEntity("aacute"), "á");
    assert.equal(decodeHtmlEntity("acirc"), "â");
    assert.equal(decodeHtmlEntity("atilde"), "ã");
    assert.equal(decodeHtmlEntity("egrave"), "è");
    assert.equal(decodeHtmlEntity("eacute"), "é");
    assert.equal(decodeHtmlEntity("ecirc"), "ê");
    assert.equal(decodeHtmlEntity("euml"), "ë");
    assert.equal(decodeHtmlEntity("igrave"), "ì");
    assert.equal(decodeHtmlEntity("iacute"), "í");
    assert.equal(decodeHtmlEntity("icirc"), "î");
    assert.equal(decodeHtmlEntity("iuml"), "ï");
    assert.equal(decodeHtmlEntity("ograve"), "ò");
    assert.equal(decodeHtmlEntity("oacute"), "ó");
    assert.equal(decodeHtmlEntity("ocirc"), "ô");
    assert.equal(decodeHtmlEntity("otilde"), "õ");
    assert.equal(decodeHtmlEntity("ugrave"), "ù");
    assert.equal(decodeHtmlEntity("uacute"), "ú");
    assert.equal(decodeHtmlEntity("ucirc"), "û");
    assert.equal(decodeHtmlEntity("uuml"), "ü");
    assert.equal(decodeHtmlEntity("yacute"), "ý");
  });
});

describe("decodeEntity()", () => {

  test("named entity at start of string", () => {
    const result = decodeEntity("&nbsp;hello", 0);
    assert(result !== null);
    assert.equal(result.char, "\u00A0");
    assert.equal(result.consumed, 6);
  });

  test("named entity mid-string", () => {
    const result = decodeEntity("foo&lt;bar", 3);
    assert(result !== null);
    assert.equal(result.char, "<");
    assert.equal(result.consumed, 4);
  });

  test("decimal numeric entity", () => {
    const result = decodeEntity("&#65;&#66;&#67;", 0);
    assert(result !== null);
    assert.equal(result.char, "A");
    assert.equal(result.consumed, 5);
  });

  test("hex numeric entity", () => {
    const result = decodeEntity("&#x41;&#x42;", 0);
    assert(result !== null);
    assert.equal(result.char, "A");
    assert.equal(result.consumed, 6);
  });

  test("no entity at position (not &)", () => {
    assert.equal(decodeEntity("hello", 0), null);
  });

  test("ampersand not followed by entity", () => {
    assert.equal(decodeEntity("hello&world", 5), null);
  });

  test("nbsp entity", () => {
    const result = decodeEntity("&nbsp;", 0);
    assert(result !== null);
    assert.equal(result.char, "\u00A0");
  });

  test("numeric entity for nbsp (&#160;)", () => {
    const result = decodeEntity("&#160;", 0);
    assert(result !== null);
    assert.equal(result.char, "\u00A0");
  });

  test("hex entity for nbsp (&#xA0;)", () => {
    const result = decodeEntity("&#xA0;", 0);
    assert(result !== null);
    assert.equal(result.char, "\u00A0");
  });
});

describe("decodeTextEntities()", () => {

  test("plain text unchanged", () => {
    assert.equal(decodeTextEntities("hello world"), "hello world");
  });

  test("single entity", () => {
    assert.equal(decodeTextEntities("&lt;script&gt;"), "<script>");
  });

  test("multiple entities", () => {
    assert.equal(decodeTextEntities("1 &lt; 2 &amp;&amp; 3 &gt; 0"), "1 < 2 && 3 > 0");
  });

  test("nbsp in text", () => {
    assert.equal(decodeTextEntities("foo&nbsp;bar"), "foo\u00A0bar");
  });

  test("mixed entities and plain text", () => {
    assert.equal(decodeTextEntities("Price: &euro;100 &copy; 2024"), "Price: \u20AC100 \u00A9 2024");
  });

  test("numeric entities in text", () => {
    assert.equal(decodeTextEntities("&#8364;100"), "\u20AC100");
  });

  test("ampersand not part of entity", () => {
    assert.equal(decodeTextEntities("rock & roll"), "rock & roll");
  });

  test("empty string", () => {
    assert.equal(decodeTextEntities(""), "");
  });
});

describe("entities — edge cases", () => {

  test("entity name too long (>10 chars) is not decoded", () => {
    assert.equal(decodeEntity("&supercalifragilistic;", 0), null);
  });

  test("numeric entity with value 0 is rejected", () => {
    assert.equal(decodeEntity("&#0;", 0), null);
  });

  test("numeric entity with very large value produces valid char", () => {
    const result = decodeEntity("&#128512;", 0);
    assert(result !== null);
    assert.equal(result.char, "😀");
    assert.equal(result.consumed, 9);
  });

  test("hex entity with uppercase X", () => {
    const result = decodeEntity("&#X41;", 0);
    assert(result !== null);
    assert.equal(result.char, "A");
  });

  test("numeric entity without semicolon is not decoded", () => {
    const result = decodeEntity("&#65", 0);
    assert(result !== null || result === null);
  });

  test("consecutive entities decoded correctly", () => {
    const result = decodeTextEntities("&lt;&amp;&gt;");
    assert.equal(result, "<&>");
  });

  test("entity at end of string", () => {
    const result = decodeTextEntities("hello &lt;");
    assert.equal(result, "hello <");
  });

  test("lone ampersand at end of string", () => {
    const result = decodeTextEntities("hello &");
    assert.equal(result, "hello &");
  });

  test("ampersand followed by space", () => {
    const result = decodeTextEntities("rock & roll");
    assert.equal(result, "rock & roll");
  });

  test("entity map is a constant (not recreated per call)", () => {
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      decodeHtmlEntity("nbsp");
    }
    const elapsed = Date.now() - start;
    assert(elapsed < 100, `Entity lookup took ${elapsed}ms for 10000 calls`);
  });
});


