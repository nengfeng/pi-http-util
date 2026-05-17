/**
 * whitespace.ts — HTML whitespace detection and collapsing.
 *
 * Pure functions for identifying and normalizing whitespace characters.
 * Handles ASCII whitespace, Unicode whitespace (nbsp, emsp, etc.),
 * and correctly iterates over surrogate pairs.
 */

// ── HTML Whitespace Code Points ──────────────────────────────────────

const HTML_WHITESPACE = new Set<number>([
  0x0020,  // space
  0x0009,  // tab
  0x000A,  // newline
  0x000D,  // carriage return
  0x00A0,  // &nbsp;
  0x2002,  // &ensp;
  0x2003,  // &emsp;
  0x2009,  // &thinsp;
  0x200B,  // &zwsp;
  0x00AD,  // soft hyphen
  0x1680,  // ogham space
  0x2000,  // en quad
  0x2001,  // em quad
  0x2004,  // three-per-em space
  0x2005,  // four-per-em space
  0x2006,  // six-per-em space
  0x2007,  // figure space
  0x2008,  // punctuation space
  0x202F,  // narrow no-break space
  0x205F,  // medium mathematical space
  0x3000,  // ideographic space
]);

/**
 * Check if a character (full code point) is HTML whitespace.
 * Correctly handles characters outside the BMP (surrogate pairs).
 */
export function isHtmlWhitespace(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return HTML_WHITESPACE.has(cp);
}

/**
 * Collapse n+1 consecutive whitespace characters into a single space.
 *
 * "foo     bar" → "foo bar"
 * "foo\u00A0\u00A0bar" → "foo bar"
 *
 * Uses spread operator to correctly iterate over surrogate pairs
 * (emoji, CJK characters outside BMP).
 */
export function collapseWhitespace(text: string): string {
  let result = "";
  let prevWasWhitespace = false;

  for (const ch of text) {
    if (isHtmlWhitespace(ch)) {
      if (!prevWasWhitespace) {
        result += " ";
        prevWasWhitespace = true;
      }
    } else {
      result += ch;
      prevWasWhitespace = false;
    }
  }

  return result;
}

/**
 * Collapse whitespace within each line and collapse multiple consecutive
 * blank lines into a single blank line.
 *
 * "foo\n\n\n\nbar" → "foo\n\nbar"
 * "foo   bar" → "foo bar"
 * "foo\n\n   \n\nbar" → "foo\n\nbar"
 *
 * Lines are trimmed, and leading/trailing blank lines are removed.
 */
export function collapseWhitespacePreserveLines(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let prevBlank = false;

  for (const line of lines) {
    const collapsed = collapseWhitespace(line).trim();
    if (collapsed === "") {
      if (!prevBlank && result.length > 0) {
        result.push("");
      }
      prevBlank = true;
    } else {
      result.push(collapsed);
      prevBlank = false;
    }
  }

  // Trim leading/trailing blank lines
  while (result.length > 0 && result[0] === "") result.shift();
  while (result.length > 0 && result[result.length - 1] === "") result.pop();

  return result.join("\n");
}
