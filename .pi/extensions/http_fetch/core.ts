/**
 * core.ts — Barrel re-export of all http_fetch pure functions.
 *
 * Actual implementations live in dedicated modules:
 * - tokenizer.ts  : HTML tokenizer (Token type, tokenize)
 * - entities.ts   : HTML entity decoding
 * - whitespace.ts : Whitespace detection and collapsing
 * - strip.ts      : Strip modes (none, whitespace, attributes, tags, html2md)
 * - fetch.ts      : Fetch pipeline (executeFetch, validateUrl, buildHeaders)
 */

// Tokenizer
export { tokenize } from "./tokenizer.ts";
export type { Token, Attribute } from "./tokenizer.ts";

// Entities
export { decodeHtmlEntity, decodeEntity, decodeTextEntities } from "./entities.ts";

// Whitespace
export { isHtmlWhitespace, collapseWhitespace, collapseWhitespacePreserveLines } from "./whitespace.ts";

// Strip modes
export {
  stripNone,
  stripWhitespace,
  stripAttributes,
  stripTags,
  stripHtmlToMd,
  getAttr,
  getAttrDecoded,
  resolveStripMethod,
  applyStrip,
} from "./strip.ts";
export type { StripMode } from "./strip.ts";

// Fetch pipeline
export {
  executeFetch,
  validateUrl,
  buildHeaders,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "./fetch.ts";
export type { FetchParams, FetchResult } from "./fetch.ts";

// In-page search
export { inPageSearch } from "./in_page_search.ts";
