# http_fetch Extension

A PI Agent extension for fetching web content and transforming HTML into clean, readable output.

## What It Does

- **Fetch URLs** from the internet with a Chromium-like User-Agent, configurable HTTP methods, headers, and redirect handling
- **Strip and transform** HTML content via 5 modes:
  - `none` — raw content, no transformation
  - `whitespace` — collapse multi-whitespace to single space
  - `attributes` — remove HTML attributes, collapse whitespace
  - `tags` — remove all HTML tags + decode entities + collapse whitespace
  - `html2md` — convert HTML to readable Markdown (headings, bold, italic, links, lists, code blocks, tables, blockquotes, etc.)
- **In-page search** — find text on a webpage with case-insensitive matching, HTML entity awareness, and configurable context extraction

From the point of view of a regular LLM usage, the html2md makes the most sense

Usage - you can just casually ask it in pi with a prompt like this:
```
Can you check from github what this project from https://github.com/kulminaator/pi-http-util  is about?
```

## Architecture

The HTML-to-Markdown converter uses a **SAX-style event-driven pipeline**:

```
tokenize(html)  →  emitEvents(html)  →  processEvents(events)  →  markdown
   tokenizer       md_emitter            md_handler
```

1. **`tokenizer.ts`** — Tokenizes raw HTML into a stream of text, tag, comment, and doctype tokens
2. **`md_emitter.ts`** — Wraps the tokenizer to produce a clean event stream (`text`, `open`, `close`), filtering comments and doctypes. Defines element classification sets (skip, block, inline, void)
3. **`md_handler.ts`** — Processes events with an element stack and dispatch table. Each element type has dedicated open/close handlers. Unknown elements are treated as block-level paragraphs. Includes output normalization
4. **`strip.ts`** — Public API for all 5 strip modes. `stripHtmlToMd()` wires together `emitEvents()` → `processEvents()`

### Tools Registered

| Tool | Description |
|------|-------------|
| `http_fetch` | Fetch a URL with configurable strip mode, truncation limits, and strategy |
| `in_page_search` | Search a webpage for text, return matching snippets with surrounding context |

## File Layout

```
.pi/extensions/http_fetch/
├── index.ts            # Entry point (exports default function, registers tools)
├── core.ts             # Barrel re-export of all pure functions
├── tokenizer.ts        # HTML tokenizer (Token type, tokenize generator)
├── entities.ts         # HTML entity decoding (named + numeric)
├── whitespace.ts       # Whitespace detection and collapsing
├── md_emitter.ts       # SAX-style event emitter (tokenize → text/open/close events)
├── md_handler.ts       # SAX-style event handler (events → Markdown, element stack)
├── strip.ts            # Strip modes (none, whitespace, attributes, tags, html2md)
└── in_page_search.ts   # In-page search tool (fetch + search + context extraction)

tests/http_fetch/
├── run-tests.ts              # Master runner (runs everything)
├── test-harness.ts           # Shared describe/test/collectTokens infrastructure
├── tokenizer.test.ts         # tokenize() + edge cases
├── entities.test.ts          # Entity decoding + edge cases
├── whitespace.test.ts        # Whitespace handling + surrogate pairs
├── md_emitter.test.ts        # Event emitter + element classification
├── md_handler.test.ts        # Event handler (HTML → Markdown conversion)
├── strip.test.ts             # All strip modes + edge cases
├── integration.test.ts       # http_fetch HTTP integration
└── in_page_search.test.ts    # in_page_search HTTP integration
```

## Running the Tests

Requires **Node.js ≥ 24** (for `--experimental-strip-types` to run TypeScript without compilation).

```bash
# Run all tests (recommended)
node --experimental-strip-types tests/http_fetch/run-tests.ts

# Or run a single test file standalone
node --experimental-strip-types tests/http_fetch/tokenizer.test.ts
node --experimental-strip-types tests/http_fetch/integration.test.ts
```

### What Gets Tested

| Suite | Coverage |
|-------|----------|
| `tokenize()` | HTML tokenizer — tags, attributes, comments, doctype |
| `tokenize() — edge cases` | Malformed HTML, unclosed tags, nested quotes, etc. |
| `decodeHtmlEntity()` | Named entity lookup, Latin-1 characters, case sensitivity |
| `decodeEntity()` | Named + numeric (decimal/hex) entity decoding |
| `entities — edge cases` | Long names, boundary values, emoji, perf, consecutive |
| `decodeTextEntities()` | Entity decoding in text streams |
| `isHtmlWhitespace()` | 16+ Unicode whitespace codepoints |
| `collapseWhitespace()` | Multi-whitespace → single space |
| `collapseWhitespace — surrogate pairs` | Emoji, CJK, surrogate pair safety |
| `emitEvents()` | SAX event stream, comment/doctype filtering, attributes |
| `headingLevel()` | h1-h6 detection, non-heading rejection |
| `isListContainer()` | ul/ol detection |
| `isTableRowElement()` | tr/td/th detection |
| `SKIP_ELEMENTS` | script, style, head, meta, noscript, etc. |
| `BLOCK_ELEMENTS` | div, p, h1, section, blockquote, table, ul, li, pre, br, hr |
| `INLINE_FORMAT_ELEMENTS` | a, b, strong, i, em, code, mark |
| `VOID_ELEMENTS` | br, img, input, hr, meta, link |
| `processEvents() — headings` | h1-h6, multiple headings with content |
| `processEvents() — bold/italic/strikethrough` | b, strong, i, em, s, strike, del, nested |
| `processEvents() — code` | inline code, pre/code blocks, whitespace preservation |
| `processEvents() — links and images` | a, img, alt escaping, missing href |
| `processEvents() — lists` | ul, ol, nested lists |
| `processEvents() — blockquote` | simple and nested blockquotes |
| `processEvents() — tables` | headers, rows, empty tables, single cells |
| `processEvents() — paragraphs and breaks` | p, br, hr, multiple hr |
| `processEvents() — skip elements` | script, style, head, noscript, template, slot |
| `processEvents() — inline extras` | sub, sup, q, abbr, mark |
| `processEvents() — entity decoding` | named entities, emoji preservation |
| `processEvents() — edge cases` | empty input, plain text, void close tags, unclosed tags, malformed HTML, unknown elements |
| `processEvents() — complex document` | full HTML document to Markdown |
| `processEvents() — details/summary` | collapsible sections |
| `processEvents() — figure/figcaption` | images with captions |
| `processEvents() — time` | datetime attribute handling |
| `processEvents() — picture/source` | responsive images |
| `stripNone()` | Identity (no-op) |
| `stripWhitespace()` | Whitespace-only collapsing |
| `stripAttributes()` | Tokenizer-based attribute removal |
| `stripTags()` | Tag removal + entity decoding |
| `stripTags() — edge cases` | Malformed HTML, nested scripts, special chars |
| `stripHtmlToMd()` | HTML → Markdown conversion |
| `stripHtmlToMd() — edge cases` | pre/code, sub/sup, q, abbr, mark, tables, emoji, etc. |
| Integration | Local HTTP server, all strip modes, error codes, network |
| `in_page_search` | Search, entity matching, case-insensitive, tag boundaries, strip modes |

Each test has a **5-second timeout** to prevent hangs.

### Test Structure

Tests are split into logical files, each independently runnable:

| File | Type | Coverage |
|------|------|----------|
| `tokenizer.test.ts` | Unit | HTML tokenizer + edge cases |
| `entities.test.ts` | Unit | Entity decoding + edge cases |
| `whitespace.test.ts` | Unit | Whitespace + surrogate pairs |
| `md_emitter.test.ts` | Unit | SAX event emitter + element classification sets |
| `md_handler.test.ts` | Unit | HTML → Markdown handler (headings, formatting, lists, tables, blockquotes, skip elements, figures, details, picture, edge cases) |
| `strip.test.ts` | Unit | All strip modes + edge cases |
| `integration.test.ts` | Integration | http_fetch HTTP server tests |
| `in_page_search.test.ts` | Integration | Search, entities, boundaries, strip modes |

- **Unit tests** — pure functions from the extension modules, no I/O
- **Integration tests** — spin up a local `http.Server` on a random port, exercise fetch + strip against real HTTP routes, tear down after
- **Shared harness** — `test-harness.ts` provides `describe`, `test`, counters, and `runSummary()` used by all files
