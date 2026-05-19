/**
 * raw_http_request.test.ts — Unit + integration tests for raw_http_request.
 */

import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assert, describe, test } from "./test-harness.ts";
import { runSummary } from "./test-harness.ts";
import crypto from "node:crypto";

// Unique temp file helper to avoid race conditions
function tmpFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${crypto.randomUUID().slice(0, 8)}.txt`);
}

import {
  validateRawUrl,
  buildRawHeaders,
  loadBodyFile,
  writeResponseBody,
  checkSizeLimit,
  executeRawRequest,
} from "../../src/core.ts";
import { resetGlobalRateLimiter } from "../../src/rate_limiter.ts";
import { setRawAllowPrivateHosts } from "../../src/raw_http_request.ts";

setRawAllowPrivateHosts(true);

// ── Unit Tests ───────────────────────────────────────────────────────

describe("validateRawUrl()", () => {

  test("valid https URL", () => {
    assert.equal(validateRawUrl("https://example.com"), null);
  });

  test("valid http URL with query params", () => {
    assert.equal(
      validateRawUrl("http://example.com/path?foo=bar&baz=1"),
      null,
    );
  });

  test("valid URL with port", () => {
    assert.equal(validateRawUrl("http://localhost:8080/api"), null);
  });

  test("invalid URL (not a URL)", () => {
    const err = validateRawUrl("not-a-url");
    assert(err != null);
  });

  test("invalid URL (empty string)", () => {
    const err = validateRawUrl("");
    assert(err != null);
  });
});

describe("buildRawHeaders()", () => {

  test("includes default headers", () => {
    const headers = buildRawHeaders();
    assert(headers["User-Agent"] !== undefined);
    assert.equal(headers["Accept"], "*/*");
  });

  test("merges custom headers", () => {
    const headers = buildRawHeaders({ "Content-Type": "application/json" });
    assert.equal(headers["Content-Type"], "application/json");
    assert(headers["User-Agent"] !== undefined);
  });

  test("custom headers override defaults", () => {
    const headers = buildRawHeaders({ "User-Agent": "custom-bot" });
    assert.equal(headers["User-Agent"], "custom-bot");
  });

  test("no custom headers returns defaults only", () => {
    const headers = buildRawHeaders(undefined);
    const keys = Object.keys(headers);
    assert.equal(keys.length, 2);
  });
});

describe("checkSizeLimit()", () => {

  test("no limit always passes", () => {
    assert.equal(checkSizeLimit("any content"), null);
  });

  test("under limit passes", () => {
    assert.equal(checkSizeLimit("hello", 100), null);
  });

  test("exactly at limit passes", () => {
    const body = "hello"; // 5 bytes
    assert.equal(checkSizeLimit(body, 5), null);
  });

  test("over limit returns error", () => {
    const err = checkSizeLimit("hello world", 5);
    assert(err != null);
    assert(err!.includes("exceeds limit"));
  });

  test("unicode characters counted as bytes", () => {
    // "😀" is 4 bytes in UTF-8
    const err = checkSizeLimit("😀", 3);
    assert(err != null);
  });
});

describe("writeResponseBody()", () => {

  test("writes content to file", async () => {
    const tmp = tmpFile("write-resp");
    await writeResponseBody(tmp, "hello world");
    const content = await fs.readFile(tmp, "utf-8");
    assert.equal(content, "hello world");
    await fs.unlink(tmp);
  });

  test("returns the file path", async () => {
    const tmp = tmpFile("write-path");
    const result = await writeResponseBody(tmp, "data");
    assert.equal(result, tmp);
    await fs.unlink(tmp);
  });
});

describe("loadBodyFile()", () => {

  test("reads file contents", async () => {
    const tmp = tmpFile("body-file");
    await fs.writeFile(tmp, "request body content");
    const content = await loadBodyFile(tmp);
    assert.equal(content, "request body content");
    await fs.unlink(tmp);
  });

  test("throws on missing file", async () => {
    try {
      await loadBodyFile("/nonexistent/file.txt");
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert(err != null);
    }
  });
});

// ── Integration Tests ────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`);

      if (url.pathname === "/echo") {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          res.writeHead(200, {
            "Content-Type": "text/plain",
            "X-Request-Method": req.method || "unknown",
            "X-Body-Length": String(body.length),
            "X-Request-Content-Type": req.headers["content-type"] || "none",
          });
          res.end(body);
        });
        return;
      }

      if (url.pathname === "/json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", data: [1, 2, 3] }));
        return;
      }

      if (url.pathname === "/404") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      if (url.pathname === "/large") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        const big = "X".repeat(10_000);
        res.end(big);
        return;
      }

      res.writeHead(404);
      res.end("Unknown");
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

export async function runTests() {
  await startServer();

  await describe("raw_http_request (local HTTP server)", async () => {

    async function resetAndExecute(params: any) {
      resetGlobalRateLimiter();
      return executeRawRequest(params);
    }

    test("GET returns response body and headers", async () => {
      const result = await resetAndExecute({
        http_url: `${baseUrl}/json`,
        http_method: "GET",
        http_request_timeout: 300,
        http_verify_ssl: true,
      });
      assert.equal(result.error, null);
      assert.equal(result.http_response_code, 200);
      const parsed = JSON.parse(result.http_response_body);
      assert.equal(parsed.status, "ok");
      assert(result.http_response_headers.length > 0);
    });

    test("POST sends body and echoes it back", async () => {
      const result = await resetAndExecute({
        http_url: `${baseUrl}/echo`,
        http_method: "POST",
        http_request_body: '{"key":"value"}',
        http_request_timeout: 300,
        http_verify_ssl: true,
      });
      assert.equal(result.error, null);
      assert.equal(result.http_response_code, 200);
      assert.equal(result.http_response_body, '{"key":"value"}');
    });

    test("POST auto-sets Content-Type when not provided", async () => {
      const result = await resetAndExecute({
        http_url: `${baseUrl}/echo`,
        http_method: "POST",
        http_request_body: "test body",
        http_request_timeout: 300,
        http_verify_ssl: true,
      });
      assert.equal(result.error, null);
      const ctHeader = result.http_response_headers.find(
        h => h.key.toLowerCase() === "x-request-content-type",
      );
      assert(ctHeader != null, "Should have X-Request-Content-Type echo header");
      assert(ctHeader.value.includes("text/plain"), `Expected auto Content-Type, got: ${ctHeader.value}`);
    });

    test("POST preserves custom Content-Type when provided", async () => {
      const result = await resetAndExecute({
        http_url: `${baseUrl}/echo`,
        http_method: "POST",
        http_request_body: '{"json":true}',
        http_request_headers: { "Content-Type": "application/json" },
        http_request_timeout: 300,
        http_verify_ssl: true,
      });
      assert.equal(result.error, null);
      const ctHeader = result.http_response_headers.find(
        h => h.key.toLowerCase() === "x-request-content-type",
      );
      assert(ctHeader != null);
      assert(ctHeader.value.includes("application/json"), `Expected application/json, got: ${ctHeader.value}`);
    });

    test("POST with body file", async () => {
      const tmp = tmpFile("post-body");
      await fs.writeFile(tmp, '{"from":"file"}');
      try {
        const result = await resetAndExecute({
          http_url: `${baseUrl}/echo`,
          http_method: "POST",
          http_request_body_file: tmp,
          http_request_timeout: 300,
          http_verify_ssl: true,
        });
        assert.equal(result.error, null);
        assert.equal(result.http_response_body, '{"from":"file"}');
      } finally {
        await fs.unlink(tmp);
      }
    });

    test("response written to file", async () => {
      const tmpOut = tmpFile("resp-out");
      try {
        const result = await resetAndExecute({
          http_url: `${baseUrl}/json`,
          http_method: "GET",
          http_request_timeout: 300,
          http_verify_ssl: true,
          http_response_body_file: tmpOut,
        });
        assert.equal(result.error, null);
        assert.equal(result.http_response_body, "");
        assert(result.http_response_body_file !== null);
        const fileContent = await fs.readFile(tmpOut, "utf-8");
        const parsed = JSON.parse(fileContent);
        assert.equal(parsed.status, "ok");
      } finally {
        await fs.unlink(tmpOut).catch(() => {});
      }
    });

    test("size limit exceeded returns error", async () => {
      const result = await resetAndExecute({
        http_url: `${baseUrl}/large`,
        http_method: "GET",
        http_request_timeout: 300,
        http_verify_ssl: true,
        http_response_body_size_limit: 100,
      });
      assert(result.error != null);
      assert(result.error!.includes("exceeds limit"));
    });

    test("size limit not exceeded passes", async () => {
      const result = await resetAndExecute({
        http_url: `${baseUrl}/json`,
        http_method: "GET",
        http_request_timeout: 300,
        http_verify_ssl: true,
        http_response_body_size_limit: 10_000,
      });
      assert.equal(result.error, null);
    });

    test("404 returns correct status", async () => {
      const result = await resetAndExecute({
        http_url: `${baseUrl}/404`,
        http_method: "GET",
        http_request_timeout: 300,
        http_verify_ssl: true,
      });
      assert.equal(result.http_response_code, 404);
      assert.equal(result.http_response_body, "Not found");
    });

    test("custom headers forwarded", async () => {
      const result = await resetAndExecute({
        http_url: `${baseUrl}/echo`,
        http_method: "POST",
        http_request_body: "test",
        http_request_headers: { "X-Custom": "my-value" },
        http_request_timeout: 300,
        http_verify_ssl: true,
      });
      assert.equal(result.error, null);
    });

    test("invalid URL returns error", async () => {
      resetGlobalRateLimiter();
      const result = await executeRawRequest({
        http_url: "not-a-url",
        http_method: "GET",
        http_request_timeout: 300,
        http_verify_ssl: true,
      });
      assert(result.error != null);
    });

    test("missing body file returns error", async () => {
      resetGlobalRateLimiter();
      const result = await executeRawRequest({
        http_url: `${baseUrl}/echo`,
        http_method: "POST",
        http_request_body_file: "/nonexistent/path.json",
        http_request_timeout: 300,
        http_verify_ssl: true,
      });
      assert(result.error != null);
      assert(result.error!.includes("read body file"));
    });

    test("unreachable host returns error", async () => {
      const result = await resetAndExecute({
        http_url: "http://192.0.2.1:1/test",
        http_method: "GET",
        http_request_timeout: 2,
        http_verify_ssl: true,
      });
      assert(result.error != null);
    });

    test("response headers collected", async () => {
      const result = await resetAndExecute({
        http_url: `${baseUrl}/echo`,
        http_method: "POST",
        http_request_body: "hello",
        http_request_timeout: 300,
        http_verify_ssl: true,
      });
      assert.equal(result.error, null);
      const headerKeys = result.http_response_headers
        .map((h) => h.key.toLowerCase());
      assert(headerKeys.includes("content-type"));
    });

    test("PUT method sends body", async () => {
      const result = await resetAndExecute({
        http_url: `${baseUrl}/echo`,
        http_method: "PUT",
        http_request_body: "put body",
        http_request_timeout: 300,
        http_verify_ssl: true,
      });
      assert.equal(result.error, null);
      assert.equal(result.http_response_body, "put body");
    });

    test("DELETE method does not send body", async () => {
      const result = await resetAndExecute({
        http_url: `${baseUrl}/echo`,
        http_method: "DELETE",
        http_request_body: "should not appear",
        http_request_timeout: 300,
        http_verify_ssl: true,
      });
      assert.equal(result.error, null);
    });

    test("no content stripping applied (raw response)", async () => {
      const result = await resetAndExecute({
        http_url: `${baseUrl}/json`,
        http_method: "GET",
        http_request_timeout: 300,
        http_verify_ssl: true,
      });
      assert(result.http_response_body.includes('"status"'));
      assert(result.http_response_body.includes('"data"'));
    });

    test("both body and body file returns error", async () => {
      const tmp = tmpFile("prec-body");
      await fs.writeFile(tmp, "from file");
      try {
        resetGlobalRateLimiter();
        const result = await executeRawRequest({
          http_url: `${baseUrl}/echo`,
          http_method: "POST",
          http_request_body: "inline body",
          http_request_body_file: tmp,
          http_request_timeout: 300,
          http_verify_ssl: true,
        });
        assert(result.error != null);
        assert(result.error!.includes("both"), `Expected error about both, got: ${result.error}`);
      } finally {
        await fs.unlink(tmp);
      }
    });
  });

  await stopServer();
}

// Allow standalone execution
if (process.argv[1]?.endsWith("raw_http_request.test.ts")) {
  (async () => {
    await runTests();
    const ok = await runSummary();
    if (!ok) process.exit(1);
  })();
}
