/**
 * md_emitter.ts — SAX-style event emitter for HTML-to-Markdown conversion.
 *
 * Wraps the HTML tokenizer to produce a clean stream of events:
 *   - { type: "text", data: string }
 *   - { type: "open", name: string, attributes: Attribute[] }
 *   - { type: "close", name: string }
 *
 * Comments and doctypes are filtered out.
 */

import { tokenize, type Token, type Attribute } from "./tokenizer.ts";

// ── Event Types ──────────────────────────────────────────────────────

export type MdEvent =
  | { type: "text"; data: string }
  | { type: "open"; name: string; attributes: Attribute[] }
  | { type: "close"; name: string };

// ── Element Classification ───────────────────────────────────────────

/** Elements whose entire subtree is discarded (no text content). */
export const SKIP_ELEMENTS = new Set([
  "script", "style", "head", "meta", "link", "title",
  "noscript", "template", "slot", "base",
]);

/** Void elements that are also skip elements (no closing tag, don't affect depth). */
export const SKIP_VOID_ELEMENTS = new Set([
  "meta", "link", "base",
]);

/** Known block-level elements. */
export const BLOCK_ELEMENTS = new Set([
  "address", "article", "aside", "blockquote", "br", "caption",
  "dd", "details", "dialog", "div", "dl", "dt", "fieldset",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3",
  "h4", "h5", "h6", "header", "hgroup", "hr", "legend", "li",
  "main", "nav", "ol", "p", "pre", "section", "summary",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr",
  "ul",
]);

/** Known inline formatting elements. */
export const INLINE_FORMAT_ELEMENTS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "code", "cite", "data",
  "del", "dfn", "em", "i", "ins", "kbd", "mark", "q",
  "rp", "rt", "ruby", "s", "samp", "small", "span",
  "strike", "strong", "sub", "sup", "time", "u", "var",
]);

/** Void (self-closing) elements that never have children. */
export const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img",
  "input", "link", "meta", "param", "source", "track", "wbr",
]);

/** Check if an element name is a heading. Returns 1-6 or 0. */
export function headingLevel(name: string): number {
  if (/^h([1-6])$/.test(name)) return parseInt(name[1], 10);
  return 0;
}

/** Check if an element is a list container (ul/ol). */
export function isListContainer(name: string): boolean {
  return name === "ul" || name === "ol";
}

/** Check if an element is a table row-related element. */
export function isTableRowElement(name: string): boolean {
  return name === "tr" || name === "td" || name === "th";
}

// ── Event Generator ──────────────────────────────────────────────────

/**
 * Yield SAX-style events from an HTML string.
 * Filters out comments and doctypes.
 */
export function* emitEvents(html: string): Generator<MdEvent> {
  for (const token of tokenize(html)) {
    if (token.kind === "text") {
      yield { type: "text", data: token.data };
    } else if (token.kind === "tag") {
      if (token.isClosing) {
        yield { type: "close", name: token.name };
      } else {
        yield { type: "open", name: token.name, attributes: token.attributes };
      }
    }
    // comments and doctypes are silently dropped
  }
}
