/**
 * strip.ts — HTML content strip modes.
 *
 * Pure functions for transforming HTML content:
 * - stripNone: identity (no transformation)
 * - stripWhitespace: collapse multi-whitespace to single space
 * - stripAttributes: remove HTML attributes, collapse whitespace
 * - stripTags: remove all HTML tags, decode entities, collapse whitespace
 * - stripHtmlToMd: convert HTML to Markdown (SAX-style event-driven)
 *
 * All functions are side-effect-free and fully unit-testable.
 */

import { tokenize, type Token } from "./tokenizer.ts";
import { decodeTextEntities } from "./entities.ts";
import { isHtmlWhitespace, collapseWhitespace } from "./whitespace.ts";
import { emitEvents } from "./md_emitter.ts";
import { processEvents } from "./md_handler.ts";

// ── Utility ──────────────────────────────────────────────────────────

/** Get an attribute value from a tag token by name (case-insensitive). */
export function getAttr(token: Extract<Token, { kind: "tag" }>, name: string): string | null {
  const attr = token.attributes.find(a => a.name.toLowerCase() === name);
  return attr?.value ?? null;
}

/** Get an attribute value with HTML entities decoded. */
export function getAttrDecoded(token: Extract<Token, { kind: "tag" }>, name: string): string | null {
  const val = getAttr(token, name);
  return val !== null ? decodeTextEntities(val) : null;
}

// ── Strip Modes ──────────────────────────────────────────────────────

/** Strip mode: "none" — no transformation. */
export function stripNone(text: string): string {
  return text;
}

/** Strip mode: "whitespace" — collapse multi-whitespace to single space. */
export function stripWhitespace(text: string): string {
  return collapseWhitespace(text);
}

/** Strip mode: "attributes" — remove HTML attributes, then collapse whitespace. */
export function stripAttributes(html: string): string {
  let output = "";
  for (const token of tokenize(html)) {
    if (token.kind === "text") {
      output += token.data;
    } else if (token.kind === "comment") {
      output += `<!--${token.data}-->`;
    } else if (token.kind === "doctype") {
      output += `<!DOCTYPE${token.data}>`;
    } else if (token.kind === "tag") {
      if (token.isClosing) {
        output += `</${token.name}>`;
      } else {
        output += `<${token.name}`;
        if (token.selfClosing) {
          output += "/";
        }
        output += ">";
      }
    }
  }
  return collapseWhitespace(output);
}

/** Strip mode: "tags" — remove all HTML tags, then collapse whitespace. */
export function stripTags(html: string): string {
  let output = "";
  let skipContent = false;
  let prevWasTag = false;

  for (const token of tokenize(html)) {
    if (token.kind === "tag" && !token.isClosing &&
        (token.name === "script" || token.name === "style")) {
      skipContent = true;
      continue;
    }
    if (token.kind === "tag" && token.isClosing &&
        (token.name === "script" || token.name === "style")) {
      skipContent = false;
      continue;
    }
    if (skipContent) continue;

    if (token.kind === "text") {
      if (prevWasTag && output.length > 0 &&
          !isHtmlWhitespace(output.at(-1)!)) {
        output += " ";
      }
      output += decodeTextEntities(token.data);
      prevWasTag = false;
    } else if (token.kind === "tag") {
      prevWasTag = true;
    }
  }
  return collapseWhitespace(output);
}

/**
 * Strip mode: "html2md" — convert HTML to Markdown.
 *
 * Uses a SAX-style event-driven parser (md_emitter + md_handler) that:
 * - Maintains an element stack to track nesting context
 * - Dispatches events to dedicated handler functions per element type
 * - Treats unknown elements as block-level paragraphs
 * - Discards content in script, style, head, meta, noscript, template, etc.
 */
export function stripHtmlToMd(html: string): string {
  return processEvents(emitEvents(html));
}
