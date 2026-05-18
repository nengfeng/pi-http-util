/**
 * in_page_search.test.ts — Integration tests for in_page_search via local HTTP server.
 */

import http from "node:http";
import { assert, describe, test } from "./test-harness.ts";
import { runSummary } from "./test-harness.ts";
import { inPageSearch } from "../../.pi/extensions/pi-http-util/core.ts";

// ── Server setup ─────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`);

      if (url.pathname === "/search-links") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html>
<body>
  <nav>
    <a href="/about">About Us</a>
    <a href="/contact">Contact</a>
    <a href="/help">Help&nbsp;Center</a>
    <a href="/privacy">Privacy Policy</a>
  </nav>
  <main>
    <p>Welcome to our site. Read our <a href="/about">About Us</a> page.</p>
    <p>Need help? Visit the <a href="/help">Help&nbsp;Center</a>.</p>
  </main>
</body>
</html>`);
        return;
      }

      if (url.pathname === "/search-entities") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html>
<body>
  <p>Price: &euro;100 &copy; 2024</p>
  <p>1 &lt; 2 &amp;&amp; 3 &gt; 0</p>
  <p>&#8364;50 is the discount.</p>
  <p>She said &quot;hello&quot; and left.</p>
</body>
</html>`);
        return;
      }

      if (url.pathname === "/search-boundary") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html>
<body>
  <div class="long-attribute-value-that-makes-the-tag-very-wide" id="x">
    <p>Before the target text. <a href="/deep-link">Target Link</a> After the target text.</p>
  </div>
</body>
</html>`);
        return;
      }

      if (url.pathname === "/search-nomatch") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html>
<body>
  <p>This page has no special content.</p>
  <p>Just some regular text here.</p>
</body>
</html>`);
        return;
      }

      if (url.pathname === "/search-script") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html>
<body>
  <script>
    var target = "secret target in script";
  </script>
  <p>This is visible text.</p>
</body>
</html>`);
        return;
      }

      if (url.pathname === "/404") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      if (url.pathname === "/500") {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
        return;
      }

      res.writeHead(404);
      res.end("Unknown route");
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      } else {
        reject(new Error("Could not get server address"));
      }
    });

    server.on("error", reject);
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

// ── Tests ────────────────────────────────────────────────────────────

export async function runTests() {
  await startServer();

  await describe("in_page_search (local HTTP server)", async () => {

    test("finds a single link by its text", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-links`, search: "About Us", context_limit: 50, strip: "html2md" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert.equal(result.results.length, 2);
      const first = result.results[0].snippet;
      assert(first.includes("About Us"));
    });

    test("finds link with HTML entity (nbsp) in text", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-links`, search: "Help Center", context_limit: 50, strip: "html2md" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert(result.results.length >= 1);
      assert(result.results[0].snippet.includes("Help Center"));
    });

    test("finds multiple matches and reports count", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-links`, search: "About Us", context_limit: 30, strip: "tags" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert.equal(result.results.length, 2);
      assert.equal(result.results[0].totalMatches, 2);
      assert.equal(result.results[1].totalMatches, 2);
    });

    test("returns no matches when text not found", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-nomatch`, search: "zzzzz-nonexistent", context_limit: 50, strip: "html2md" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert.equal(result.results.length, 0);
    });

    test("does not match text inside <script> blocks", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-script`, search: "secret target in script", context_limit: 50, strip: "html2md" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert.equal(result.results.length, 0);
    });

    test("strip=none returns raw HTML around match", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-links`, search: "Contact", context_limit: 50, strip: "none" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert(result.results.length >= 1);
      assert(result.results[0].snippet.includes("<"));
      assert(result.results[0].snippet.includes("href"));
    });

    test("strip=attributes returns HTML without attributes", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-links`, search: "Contact", context_limit: 50, strip: "attributes" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert(result.results.length >= 1);
      const snippet = result.results[0].snippet;
      assert(snippet.includes("<"));
      assert(!snippet.includes("href"));
      assert(!snippet.includes("="));
    });

    test("strip=tags returns plain text", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-links`, search: "Contact", context_limit: 50, strip: "tags" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert(result.results.length >= 1);
      const snippet = result.results[0].snippet;
      assert(!snippet.includes("<"));
      assert(snippet.includes("Contact"));
    });

    test("respects context_limit parameter", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-links`, search: "Contact", context_limit: 20, strip: "tags" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert(result.results.length >= 1);
      const snippet = result.results[0].snippet;
      const idx = snippet.indexOf("Contact");
      assert(idx >= 0);
      assert(idx <= 20, `Expected at most 20 chars before match, got ${idx}`);
      const afterLen = snippet.length - idx - "Contact".length;
      assert(afterLen <= 20, `Expected at most 20 chars after match, got ${afterLen}`);
    });

    test("finds entity-encoded text (&euro; → €)", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-entities`, search: "€100", context_limit: 30, strip: "tags" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert(result.results.length >= 1);
      assert(result.results[0].snippet.includes("€100"));
    });

    test("finds numeric entity-encoded text (&#8364; → €)", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-entities`, search: "€50", context_limit: 30, strip: "tags" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert(result.results.length >= 1);
      assert(result.results[0].snippet.includes("€50"));
    });

    test("finds text with decoded &lt; and &gt; entities", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-entities`, search: "1 < 2", context_limit: 30, strip: "tags" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert(result.results.length >= 1);
      assert(result.results[0].snippet.includes("1 < 2"));
    });

    test("finds text with decoded &amp; entities", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-entities`, search: "&&", context_limit: 30, strip: "tags" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert(result.results.length >= 1);
      assert(result.results[0].snippet.includes("&&"));
    });

    test("finds text with decoded &quot; entities", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-entities`, search: '"hello"', context_limit: 30, strip: "tags" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert(result.results.length >= 1);
      assert(result.results[0].snippet.includes('"hello"'));
    });

    test("case-insensitive search", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-links`, search: "about us", context_limit: 50, strip: "tags" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert(result.results.length >= 1);
    });

    test("case-insensitive search with mixed case query", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-links`, search: "ABOUT US", context_limit: 50, strip: "tags" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert(result.results.length >= 1);
    });

    test("tag boundary: match near a long tag extracts full tag", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-boundary`, search: "Target Link", context_limit: 30, strip: "none" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert(result.results.length >= 1);
      const snippet = result.results[0].snippet;
      assert(snippet.includes("Target Link"));
      const openTags = (snippet.match(/</g) || []).length;
      const closeTags = (snippet.match(/>/g) || []).length;
      assert.equal(openTags, closeTags, `Tag imbalance: ${openTags} < vs ${closeTags} >`);
    });

    test("context_limit=0 returns only the match", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-links`, search: "Contact", context_limit: 0, strip: "tags" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert(result.results.length >= 1);
      const snippet = result.results[0].snippet;
      assert(snippet.includes("Contact"));
      const idx = snippet.indexOf("Contact");
      assert(idx <= 0, `Expected match at start with 0 context, got idx=${idx}`);
      const afterLen = snippet.length - idx - "Contact".length;
      assert(afterLen <= 0, `Expected no trailing context with 0, got ${afterLen}`);
    });

    test("large context_limit captures surrounding content", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-links`, search: "Contact", context_limit: 500, strip: "tags" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert(result.results.length >= 1);
      const snippet = result.results[0].snippet;
      assert(snippet.includes("Contact"));
      assert(snippet.includes("About") || snippet.includes("Help") || snippet.includes("Privacy"));
    });

    test("404 page returns isError=true", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/404`, search: "anything", context_limit: 50, strip: "html2md" },
        undefined,
      );
      assert.equal(result.isError, true);
      assert.equal(result.status, 404);
    });

    test("500 page returns isError=true", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/500`, search: "anything", context_limit: 50, strip: "html2md" },
        undefined,
      );
      assert.equal(result.isError, true);
      assert.equal(result.status, 500);
    });

    test("nonexistent host throws error", async () => {
      try {
        await inPageSearch(
          { url: "http://192.0.2.1:1/page", search: "test", context_limit: 50, strip: "html2md" },
          AbortSignal.timeout(2000),
        );
        assert.fail("Should have thrown");
      } catch (err: any) {
        assert(err != null);
        assert(typeof err.message === "string");
      }
    });

    test("match index and total are correct", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-links`, search: "About Us", context_limit: 30, strip: "tags" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert.equal(result.results.length, 2);
      assert.equal(result.results[0].matchIndex, 1);
      assert.equal(result.results[1].matchIndex, 2);
    });

    test("strip=html2md converts link to markdown syntax", async () => {
      const result = await inPageSearch(
        { url: `${baseUrl}/search-links`, search: "About Us", context_limit: 100, strip: "html2md" },
        undefined,
      );
      assert.equal(result.isError, false);
      assert(result.results.length >= 1);
      const hasMarkdownLink = result.results.some(r => r.snippet.includes("[About Us]"));
      assert(hasMarkdownLink, "Expected markdown link syntax [About Us](url)");
    });
  });

  await stopServer();
}

// Allow standalone execution: node --experimental-strip-types in_page_search.test.ts
if (process.argv[1]?.endsWith("in_page_search.test.ts")) {
  (async () => {
    await runTests();
    const ok = await runSummary();
    if (!ok) process.exit(1);
  })();
}
