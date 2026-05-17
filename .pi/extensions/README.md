# http_fetch Extension

Fetch URLs from the internet with content stripping and Markdown conversion.

## Running the Tests

Requires **Node.js ≥ 24** (for `--experimental-strip-types` to run TypeScript without compilation).

```bash
node --experimental-strip-types .pi/extensions/http_fetch/http_fetch.test.ts
```

### What Gets Tested

| Suite | Tests | Coverage |
|-------|-------|----------|
| `tokenize()` | 18 | HTML tokenizer — tags, attributes, comments, doctype |
| `decodeHtmlEntity()` | 3 | Named entity lookup |
| `decodeEntity()` | 9 | Named + numeric (decimal/hex) entity decoding |
| `decodeTextEntities()` | 8 | Entity decoding in text streams |
| `isHtmlWhitespace()` | 3 | 16+ Unicode whitespace codepoints |
| `collapseWhitespace()` | 15 | Multi-whitespace → single space |
| `stripNone()` | 2 | Identity (no-op) |
| `stripWhitespace()` | 4 | Whitespace-only collapsing |
| `stripAttributes()` | 10 | Tokenizer-based attribute removal |
| `stripTags()` | 14 | Tag removal + entity decoding |
| `stripHtmlToMd()` | 27 | HTML → Markdown conversion |
| Integration | 17 | Local HTTP server, all strip modes end-to-end |

Each test has a **5-second timeout** to prevent hangs.

### Test Structure

- **Unit tests** — pure functions from `http_fetch_core.ts`, no I/O
- **Integration tests** — spin up a local `http.Server` on a random port, exercise fetch + strip against real HTTP routes, tear down after
