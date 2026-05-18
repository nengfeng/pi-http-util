# HTTP Utility Extension

A PI Agent extension for fetching web content, transforming HTML into clean output, and making raw HTTP requests.

## Installation

### Via `pi install` (recommended)

Install directly from the GitHub repository:

```bash
pi install git:github.com/kulminaator/pi-http-util
```

This writes the package to your user settings (`~/.pi/agent/settings.json`) so it is available for all projects. Use `-l` to install project-locally (`.pi/settings.json`) instead:

```bash
pi install -l git:github.com/kulminaator/pi-http-util
```

Pin to a specific tag or branch:

```bash
pi install git:github.com/kulminaator/pi-http-util@v1.0.0
```

### Via `settings.json`

Add the package manually to your settings:

```json
{
  "packages": [
    "git:github.com/kulminaator/pi-http-util"
  ]
}
```

### Manual installation

Clone the repository and place it in pi's extension directory:

```bash
git clone https://github.com/kulminaator/pi-http-util.git ~/.pi/agent/extensions/pi-http-util
```

Or for project-local use:

```bash
git clone https://github.com/kulminaator/pi-http-util.git .pi/extensions/pi-http-util
```

### Try it without installing

Test the extension for a single session:

```bash
pi -e git:github.com/kulminaator/pi-http-util
```

## What It Does

### `http_fetch` — Fetch and Transform HTML

- **Fetch URLs** from the internet with a Chromium-like User-Agent, configurable HTTP methods, headers, and redirect handling
- **Strip and transform** HTML content via 5 modes:
  - `none` — raw content, no transformation
  - `whitespace` — collapse multi-whitespace to single space
  - `attributes` — remove HTML attributes, collapse whitespace
  - `tags` — remove all HTML tags + decode entities + collapse whitespace
  - `html2md` — convert HTML to readable Markdown (headings, bold, italic, links, lists, code blocks, tables, blockquotes, etc.)
- **Content-Type safety** — strip modes are only applied when the response `Content-Type` is `text/html`. For non-HTML responses (JSON, plain text, etc.), the tool falls back to `strip=none` automatically, preserving the original content
- **Rich response metadata** — every response includes the HTTP status code, all response headers, and the requested vs. actually applied strip method. Headers are printed directly in the output text under a `Response Headers:` section so LLM agents can read them without needing to inspect hidden metadata fields
- **In-page search** — find text on a webpage with case-insensitive matching, HTML entity awareness, and configurable context extraction

### `raw_http_request` — Raw HTTP Requests

- **Send raw HTTP requests** with no content stripping or transformation — responses are returned exactly as received
- **File body input** — load request body from a file via `http_request_body_file`
- **File response output** — write response body to a file via `http_response_body_file` (body returned to the LLM is empty in this case)
- **Response size limiting** — cap accepted response size with `http_response_body_size_limit` (errors if exceeded)
- **Configurable timeout** — set request timeout via `http_request_timeout` (default: 300 seconds)
- **SSL verification control** — skip SSL certificate verification with `http_verify_ssl: false`
- **Any HTTP method** — supports GET, POST, PUT, DELETE, PATCH, HEAD, and any custom method
- **Unicode-safe** — correctly handles UTF-8 content (e.g. `ü õ ä ö`) in both request bodies and responses

From the point of view of a regular LLM usage, the html2md makes the most sense for web pages.

Usage - you can just casually ask it in pi with a prompt like this:
```
Can you check from github what this project from https://github.com/kulminaator/pi-http-util  is about?
```

For raw API interactions, use `raw_http_request` when you need unaltered responses (JSON APIs, file uploads, binary data, etc.).

## Response Formats

### `http_fetch` Response

The `http_fetch` tool output is a plain-text block visible to the LLM. It starts with a metadata header, followed by a `---` separator, then the body content:

```
HTTP 200 https://example.com
Content-Type: text/html; charset=UTF-8
Raw size: 42.1KB (43100 chars)
Strip: html2md → 8.3KB (8480 chars)
Lines: 312

Response Headers:
  content-type: text/html; charset=UTF-8
  cache-control: max-age=60, public
  server: cloudflare
  ...
---
# Page Title

Converted Markdown content here...
```

The tool also returns a structured `details` object with the same metadata for programmatic access:

| Field | Type | Description |
|-------|------|-------------|
| `httpStatusCode` | `number` | The HTTP status code returned by the server |
| `headers` | `{ key, value }[]` | All response headers as key-value pairs |
| `contentType` | `string` | The response `Content-Type` header |
| `requestedStripMethod` | `string` | The strip mode the caller requested |
| `appliedStripMethod` | `string` | The strip mode that was actually applied (may differ for non-HTML) |

When a non-HTML response is received and a strip mode other than `none` was requested, the result text shows `(skipped, non-HTML content)` to make the fallback transparent.

### `raw_http_request` Response

The `raw_http_request` tool returns raw, unaltered response data:

```
HTTP 201
Method: POST
URL: http://api.example.com/posts
Body size: 187B bytes
---
{
  "id": "abc123",
  "title": "My Post",
  "body": "Hello world"
}

Response Headers:
  content-type: application/json
  date: Mon, 18 May 2026 09:06:32 GMT
  ...
```

When `http_response_body_file` is set, the body is written to the file instead:

```
HTTP 200
Method: GET
URL: http://api.example.com/posts
Response written to: /path/to/response.json

Response Headers:
  content-type: application/json
  ...
```

The tool returns a structured `details` object with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `http_response_code` | `number` | The HTTP status code |
| `http_response_headers` | `{ key, value }[]` | All response headers |
| `http_response_body` | `string` | Raw response body (empty if written to file) |
| `http_response_body_file` | `string \| null` | Path of file written (null if not used) |
| `error` | `string \| null` | Error message (null on success) |

## Architecture

The HTML-to-Markdown converter uses a **SAX-style event-driven pipeline**:

```
tokenize(html)  →  emitEvents(html)  →  processEvents(events)  →  markdown
   tokenizer       md_emitter            md_handler
```

1. **`tokenizer.ts`** — Tokenizes raw HTML into a stream of text, tag, comment, and doctype tokens
2. **`md_emitter.ts`** — Wraps the tokenizer to produce a clean event stream (`text`, `open`, `close`), filtering comments and doctypes. Defines element classification sets (skip, block, inline, void)
3. **`md_handler.ts`** — Processes events with an element stack and dispatch table. Each element type has dedicated open/close handlers. Unknown elements are treated as block-level paragraphs. Includes output normalization
4. **`strip.ts`** — Public API for all 5 strip modes. Provides `resolveStripMethod()` for Content-Type-aware fallback, `applyStrip()` for dispatch, and `stripHtmlToMd()` which wires together `emitEvents()` → `processEvents()` → `collapseBlankLines()`
5. **`fetch.ts`** — Fetch pipeline: `executeFetch()` (HTTP fetch + header collection + strip resolution), `validateUrl()`, `buildHeaders()`. Extracted from the tool so it can be tested independently

### Content-Type Safety

The `resolveStripMethod(requested, contentType)` function checks whether the response `Content-Type` contains `text/html`. If not, it returns `"none"` regardless of the requested mode (unless `"none"` was already requested). This prevents HTML-specific transformations from corrupting JSON, plain text, or other non-HTML payloads.

### Tools Registered

| Tool | Description |
|------|-------------|
| `http_fetch` | Fetch a URL with configurable strip mode, truncation limits, and strategy |
| `in_page_search` | Search a webpage for text, return matching snippets with surrounding context |
| `raw_http_request` | Send raw HTTP requests with no content stripping, file I/O, and size limits |

## File Layout

```
.pi/extensions/pi-http-util/
├── index.ts                   # Entry point (exports default function, registers tools)
├── core.ts                    # Barrel re-export of all pure functions
├── fetch.ts                   # Fetch pipeline (executeFetch, validateUrl, buildHeaders)
├── raw_http_request.ts        # Raw HTTP request tool (no stripping, file I/O, size limits)
├── tokenizer.ts               # HTML tokenizer (Token type, tokenize generator)
├── entities.ts                # HTML entity decoding (named + numeric)
├── whitespace.ts              # Whitespace detection and collapsing
├── md_emitter.ts              # SAX-style event emitter (tokenize → text/open/close events)
├── md_handler.ts              # SAX-style event handler (events → Markdown, element stack)
├── strip.ts                   # Strip modes, resolveStripMethod, applyStrip
└── in_page_search.ts          # In-page search tool (fetch + search + context extraction)

tests/pi-http-util/
├── run-tests.ts                   # Master runner (runs everything)
├── test-harness.ts                # Shared describe/test/collectTokens infrastructure
├── tokenizer.test.ts              # tokenize() + edge cases
├── entities.test.ts               # Entity decoding + edge cases
├── whitespace.test.ts             # Whitespace handling + surrogate pairs
├── md_emitter.test.ts             # Event emitter + element classification
├── md_handler.test.ts             # Event handler (HTML → Markdown conversion)
├── strip.test.ts                  # All strip modes + edge cases
├── integration.test.ts            # http_fetch HTTP integration
├── tool.test.ts                   # Tool execute pipeline (headers, fallback, response structure)
├── in_page_search.test.ts         # in_page_search HTTP integration
└── raw_http_request.test.ts       # Raw HTTP request (validation, file I/O, size limits, server)
```

## Running the Tests

Requires **Node.js ≥ 24** (for `--experimental-strip-types` to run TypeScript without compilation).

```bash
# Run all tests (recommended)
node --experimental-strip-types tests/pi-http-util/run-tests.ts

# Or run a single test file standalone
node --experimental-strip-types tests/pi-http-util/tokenizer.test.ts
node --experimental-strip-types tests/pi-http-util/integration.test.ts
```

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
| `integration.test.ts` | Integration | http_fetch HTTP server tests, Content-Type fallback, JSON/plain-text safety |
| `tool.test.ts` | Integration | Tool execute pipeline — headers, httpStatusCode, strip fallback, response structure |
| `in_page_search.test.ts` | Integration | Search, entities, boundaries, strip modes |
| `raw_http_request.test.ts` | Unit + Integration | URL validation, headers, size limits, file I/O, local server (GET/POST/PUT/DELETE) |

- **Unit tests** — pure functions from the extension modules, no I/O
- **Integration tests** — spin up a local `http.Server` on a random port, exercise fetch + strip against real HTTP routes, tear down after
- **Shared harness** — `test-harness.ts` provides `describe`, `test`, counters, and `runSummary()` used by all files
- **Timeouts** — each test has a 5-second timeout to prevent hangs
