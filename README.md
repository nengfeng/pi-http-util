# http_fetch Extension

Utility for PI Agent to make http calls (to fetch webpages, raw content etc.) with slight capabilities of 
converting the html to md, strip attributes or whole tags and make a quick in page search.

Abilities:
- Fetch URLs from the internet with content stripping and Markdown conversion.
- Do searches within those pages (eg. for scenarios where md content doesn't provide good links and we need to reverse engineer).

## File Layout

```
.pi/extensions/http_fetch/
├── index.ts            # Entry point (exports default function, registers tools)
├── core.ts             # Barrel re-export of all pure functions
├── tokenizer.ts        # HTML tokenizer (Token type, tokenize generator)
├── entities.ts         # HTML entity decoding (named + numeric)
├── whitespace.ts       # Whitespace detection and collapsing
├── strip.ts            # Strip modes (none, whitespace, attributes, tags, html2md)
└── in_page_search.ts   # In-page search tool (fetch + search + context extraction)

tests/http_fetch/
├── run-tests.ts              # Master runner (runs everything)
├── test-harness.ts           # Shared describe/test/collectTokens infrastructure
├── tokenizer.test.ts         # tokenize() + edge cases
├── entities.test.ts          # Entity decoding + edge cases
├── whitespace.test.ts        # Whitespace handling + surrogate pairs
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
| `strip.test.ts` | Unit | All strip modes + edge cases |
| `integration.test.ts` | Integration | http_fetch HTTP server tests |
| `in_page_search.test.ts` | Integration | Search, entities, boundaries, strip modes |

- **Unit tests** — pure functions from the extension modules, no I/O
- **Integration tests** — spin up a local `http.Server` on a random port, exercise fetch + strip against real HTTP routes, tear down after
- **Shared harness** — `test-harness.ts` provides `describe`, `test`, counters, and `runSummary()` used by all files
