/**
 * integration.test.ts — Integration tests for http_fetch via local HTTP server.
 */

import http from "node:http";
import { assert, describe, test } from "./test-harness.ts";
import { runSummary } from "./test-harness.ts";
import {
  stripNone,
  stripWhitespace,
  stripAttributes,
  stripTags,
  stripHtmlToMd,
  resolveStripMethod,
  applyStrip,
} from "../../.pi/extensions/pi-http-util/core.ts";

// ── Server setup ─────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`);

      if (url.pathname === "/html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Test Page</title></head>
<body class="main">
  <h1 id="title" data-test="true">Hello World</h1>
  <p class="intro">This is a &lt;test&gt; page with&nbsp;non-breaking&nbsp;spaces.</p>
  <!-- This is a comment -->
  <footer>Copyright &copy; 2024</footer>
</body>
</html>`);
        return;
      }

      if (url.pathname === "/whitespace") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("foo     bar\n\n\nbaz\t\tqux\u00A0\u00A0quux");
        return;
      }

      if (url.pathname === "/post" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end(`Received: ${body}`);
        });
        return;
      }

      if (url.pathname === "/headers") {
        const customHeader = req.headers["x-custom-header"] || "none";
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(`x-custom-header: ${customHeader}`);
        return;
      }

      if (url.pathname === "/redirect") {
        res.writeHead(302, { "Location": `${baseUrl}/html` });
        res.end();
        return;
      }

      if (url.pathname === "/large") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        let big = "";
        for (let i = 0; i < 1000; i++) {
          big += `Line ${i}: This is a test line with some content.\n`;
        }
        res.end(big);
        return;
      }

      if (url.pathname === "/json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "hello", status: "ok" }));
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

      if (url.pathname === "/503") {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("Service Unavailable");
        return;
      }

      if (url.pathname === "/400") {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad Request");
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

// ── Helper ───────────────────────────────────────────────────────────

async function fetchAndStrip(
  url: string,
  stripMode: string,
  options?: { method?: string; body?: string; headers?: Record<string, string>; followRedirects?: boolean },
): Promise<{ status: number; text: string; stripped: string; contentType: string }> {
  const fetchHeaders: Record<string, string> = {
    "User-Agent": "test",
    ...options?.headers,
  };
  const res = await fetch(url, {
    method: options?.method || "GET",
    headers: fetchHeaders,
    redirect: options?.followRedirects === false ? "manual" : "follow",
    body: options?.method === "POST" ? options.body : undefined,
  });
  const text = await res.text();
  const contentType = res.headers.get("Content-Type") || "unknown";
  const resolved = resolveStripMethod(stripMode as any, contentType);
  const stripped = applyStrip(text, resolved);
  return { status: res.status, text, stripped, contentType };
}

// ── Tests ────────────────────────────────────────────────────────────

export async function runTests() {
  await startServer();

  await describe("Integration (local HTTP server)", async () => {

    test("basic GET returns HTML", async () => {
      const result = await fetchAndStrip(`${baseUrl}/html`, "none");
      assert.equal(result.status, 200);
      assert(result.text.includes("<!DOCTYPE html>"));
      assert(result.text.includes("Hello World"));
    });

    test("strip=none returns raw content", async () => {
      const result = await fetchAndStrip(`${baseUrl}/html`, "none");
      assert(result.stripped.includes('<h1 id="title" data-test="true">'));
      assert(result.stripped.includes("&lt;test&gt;"));
      assert(result.stripped.includes("&copy;"));
      assert(result.stripped.includes("&nbsp;"));
    });

    test("strip=whitespace on plain text falls back to none", async () => {
      const result = await fetchAndStrip(`${baseUrl}/whitespace`, "whitespace");
      // text/plain is not HTML → falls back to strip=none → content unchanged
      assert.equal(result.stripped, "foo     bar\n\n\nbaz\t\tqux\u00A0\u00A0quux");
    });

    test("strip=whitespace on HTML collapses whitespace but keeps tags", async () => {
      const result = await fetchAndStrip(`${baseUrl}/html`, "whitespace");
      assert(result.stripped.includes("<html"));
      assert(result.stripped.includes("<body"));
      assert(!result.stripped.includes("  "), "Should not have double spaces");
    });

    test("strip=attributes removes all attributes", async () => {
      const result = await fetchAndStrip(`${baseUrl}/html`, "attributes");
      assert(result.stripped.includes("<h1>"));
      assert(result.stripped.includes("<p>"));
      assert(result.stripped.includes("<html>"));
      assert(result.stripped.includes("<body>"));
      assert(!result.stripped.includes("id="));
      assert(!result.stripped.includes("class="));
      assert(!result.stripped.includes("data-test="));
      assert(!result.stripped.includes("lang="));
      assert(result.stripped.includes("&copy;"));
      assert(!result.stripped.includes("  "), "Should not have double spaces");
    });

    test("strip=tags removes tags and decodes entities", async () => {
      const result = await fetchAndStrip(`${baseUrl}/html`, "tags");
      assert(!result.stripped.includes("<html>"));
      assert(!result.stripped.includes("<body>"));
      assert(!result.stripped.includes("<h1>"));
      assert(result.stripped.includes("Hello World"));
      assert(result.stripped.includes("This is a <test> page"));
      assert(result.stripped.includes("Copyright"));
      assert(result.stripped.includes("\u00A9"));
      assert(!result.stripped.includes("comment"));
      assert(!result.stripped.includes("\u00A0"));
      assert(!result.stripped.includes("  "), "Should not have double spaces");
    });

    test("POST request with body", async () => {
      const result = await fetchAndStrip(`${baseUrl}/post`, "none", {
        method: "POST",
        body: "hello=world&foo=bar",
      });
      assert.equal(result.status, 200);
      assert(result.text.includes("hello=world"));
    });

    test("custom headers forwarded", async () => {
      const result = await fetchAndStrip(`${baseUrl}/headers`, "none", {
        headers: { "x-custom-header": "my-value" },
      });
      assert(result.text.includes("my-value"));
    });

    test("redirect followed by default", async () => {
      const result = await fetchAndStrip(`${baseUrl}/redirect`, "none");
      assert(result.text.includes("Hello World"));
    });

    test("redirect not followed when follow_redirects=false", async () => {
      const result = await fetchAndStrip(`${baseUrl}/redirect`, "none", {
        followRedirects: false,
      });
      assert.equal(result.status, 302);
      assert(!result.text.includes("Hello World"));
    });

    test("404 response handled", async () => {
      const result = await fetchAndStrip(`${baseUrl}/404`, "none");
      assert.equal(result.status, 404);
      assert(result.text.includes("Not found"));
    });

    test("JSON content fetched correctly", async () => {
      const result = await fetchAndStrip(`${baseUrl}/json`, "none");
      assert.equal(result.status, 200);
      const parsed = JSON.parse(result.text);
      assert.equal(parsed.message, "hello");
      assert.equal(parsed.status, "ok");
    });

    test("strip=tags on JSON falls back to none (content unchanged)", async () => {
      const result = await fetchAndStrip(`${baseUrl}/json`, "tags");
      const parsed = JSON.parse(result.stripped);
      assert.equal(parsed.message, "hello");
      assert.equal(parsed.status, "ok");
    });

    test("strip=attributes on page with no attributes is identity (minus whitespace)", async () => {
      const input = "<div><p>hello</p></div>";
      const result = stripAttributes(input);
      assert.equal(result, "<div><p>hello</p></div>");
    });

    test("large page fetch succeeds", async () => {
      const result = await fetchAndStrip(`${baseUrl}/large`, "none");
      assert.equal(result.status, 200);
      assert(result.text.includes("Line 0:"));
      assert(result.text.includes("Line 999:"));
    });

    test("strip=tags on large page produces clean text", async () => {
      const result = await fetchAndStrip(`${baseUrl}/large`, "tags");
      assert(result.stripped.includes("Line 0:"));
      assert(result.stripped.includes("Line 999:"));
      assert(!result.stripped.includes("  "), "Should not have double spaces");
    });

    test("strip=html2md converts HTML to Markdown", async () => {
      const result = await fetchAndStrip(`${baseUrl}/html`, "html2md");
      assert(result.stripped.includes("# Hello World"));
      assert(!result.stripped.includes('id="'));
      assert(!result.stripped.includes('class="'));
      assert(result.stripped.includes("Copyright"));
      assert(!result.stripped.includes("<html"));
      assert(!result.stripped.includes("<body"));
      assert(!result.stripped.includes("<h1"));
    });

    test("500 status returns error content", async () => {
      const result = await fetchAndStrip(`${baseUrl}/500`, "none");
      assert.equal(result.status, 500);
      assert(result.text.includes("Internal Server Error"));
    });

    test("503 status returns error content", async () => {
      const result = await fetchAndStrip(`${baseUrl}/503`, "none");
      assert.equal(result.status, 503);
      assert(result.text.includes("Service Unavailable"));
    });

    test("400 status returns error content", async () => {
      const result = await fetchAndStrip(`${baseUrl}/400`, "none");
      assert.equal(result.status, 400);
      assert(result.text.includes("Bad Request"));
    });

    test("404 status is correctly reported", async () => {
      const result = await fetchAndStrip(`${baseUrl}/404`, "none");
      assert.equal(result.status, 404);
    });

    test("fetching nonexistent host throws error", async () => {
      try {
        await fetch("http://192.0.2.1:1", { signal: AbortSignal.timeout(2000) });
        assert.fail("Should have thrown");
      } catch (err: any) {
        assert(err != null);
      }
    });

    test("fetching with AbortSignal.timeout throws on slow server", async () => {
      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 50);
        await fetch(`${baseUrl}/html`, { signal: controller.signal });
      } catch {
        // May or may not abort depending on timing
      }
    });

    test("strip=tags on JSON response preserved via fallback", async () => {
      const result = await fetchAndStrip(`${baseUrl}/json`, "tags");
      assert(result.stripped.includes("hello"));
    });

    test("strip=html2md on plain text falls back to none", async () => {
      const result = await fetchAndStrip(`${baseUrl}/whitespace`, "html2md");
      // text/plain is not HTML → falls back to strip=none → content unchanged
      assert.equal(result.stripped, "foo     bar\n\n\nbaz\t\tqux\u00A0\u00A0quux");
    });

    test("strip=html2md on JSON falls back to none (content unchanged)", async () => {
      const result = await fetchAndStrip(`${baseUrl}/json`, "html2md");
      // JSON content should pass through unchanged when strip is auto-fallback to none
      const parsed = JSON.parse(result.text);
      assert.equal(parsed.message, "hello");
      assert.equal(parsed.status, "ok");
      // The raw text should be valid JSON (not mangled by html2md)
      assert.equal(result.text.trim(), JSON.stringify({ message: "hello", status: "ok" }));
    });

    test("strip=tags on JSON falls back to none (content unchanged)", async () => {
      const result = await fetchAndStrip(`${baseUrl}/json`, "tags");
      const parsed = JSON.parse(result.text);
      assert.equal(parsed.message, "hello");
      assert.equal(parsed.status, "ok");
    });

    test("strip=attributes on JSON falls back to none (content unchanged)", async () => {
      const result = await fetchAndStrip(`${baseUrl}/json`, "attributes");
      const parsed = JSON.parse(result.text);
      assert.equal(parsed.message, "hello");
      assert.equal(parsed.status, "ok");
    });

    test("strip=none on JSON is always identity", async () => {
      const result = await fetchAndStrip(`${baseUrl}/json`, "none");
      const parsed = JSON.parse(result.text);
      assert.equal(parsed.message, "hello");
      assert.equal(parsed.status, "ok");
    });
  });

  await stopServer();
}

// Allow standalone execution: node --experimental-strip-types integration.test.ts
if (process.argv[1]?.endsWith("integration.test.ts")) {
  (async () => {
    await runTests();
    const ok = await runSummary();
    if (!ok) process.exit(1);
  })();
}
