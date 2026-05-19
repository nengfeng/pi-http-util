/**
 * http_fetch — Fetch any URL from the internet.
 *
 * Uses pi-http-util User-Agent.
 * Supports content stripping (whitespace normalization, attribute removal,
 * tag removal) and configurable length limits.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { truncateHead, truncateTail, formatSize } from "@earendil-works/pi-coding-agent";
import {
  executeFetch,
  validateUrl,
  buildHeaders,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "./fetch";
import type { StripMode } from "./strip";
import { inPageSearch } from "./in_page_search";
import { executeRawRequest } from "./raw_http_request";
import type { RawRequestParams } from "./raw_http_request";

const DEFAULT_CONTEXT_LIMIT = 100;   // chars of context around a match
const DEFAULT_RAW_TIMEOUT = 30;     // seconds

// ── Tool ─────────────────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "http_fetch",
    label: "HTTP Fetch",
    description:
      "Fetch a URL from the internet. " +
      "Supports content stripping via the `strip` parameter and configurable " +
      "length limits. Use `strip` to clean up HTML: `html2md` (default, convert " +
      "HTML to Markdown with headings, bold, links, lists, etc.), `tags` (remove " +
      "HTML tags + decode entities + collapse whitespace), `attributes` (remove " +
      "HTML attributes + collapse whitespace), `none` (raw content). Use " +
      "`max_bytes` and `max_lines` to cap output size. Truncation strategy: " +
      "`head` keeps the beginning, `tail` keeps the end.",
    promptSnippet: "Fetch web pages via HTTP (strip mode, truncation)",
    promptGuidelines: [
      "Use http_fetch to retrieve web content when the user asks to fetch, browse, or read a URL.",
      "Default strip=html2md converts HTML to readable Markdown — use this for most web pages.",
      "Use http_fetch with strip=tags to extract plain text from HTML (no Markdown formatting).",
      "Use http_fetch with strip=attributes to keep HTML structure but remove clutter.",
      "Use http_fetch with strip=none for raw HTML when you need the full source.",
      "Set max_bytes and max_lines to avoid overwhelming context with large pages.",
    ],

    parameters: Type.Object({
      url: Type.String({
        description: "The URL to fetch (e.g. https://example.com)",
      }),
      method: Type.Optional(
        Type.String({
          description:
            "HTTP method (default: GET). Common values: GET, HEAD, POST",
        })
      ),
      headers: Type.Optional(
        Type.String({
          description:
            "Extra headers as a JSON string, e.g. '{\"Accept\":\"application/json\"}'",
        })
      ),
      body: Type.Optional(
        Type.String({
          description: "Request body for POST/PUT (ignored for GET)",
        })
      ),
      follow_redirects: Type.Optional(
        Type.Boolean({
          description: "Follow HTTP redirects (default: true)",
        })
      ),
      strip: Type.Optional(
        StringEnum(["html2md", "tags", "attributes", "whitespace", "none"] as const, {
          description:
            "Content stripping mode. `html2md` (default) = convert HTML to Markdown " +
            "(headings, bold, italic, links, lists, code blocks, tables, blockquotes, etc.) " +
            "+ collapse whitespace. `tags` = remove HTML tags + decode entities + collapse " +
            "whitespace. `attributes` = remove HTML attributes + collapse whitespace. " +
            "`whitespace` = collapse multi-whitespace to single space. `none` = raw content.",
        })
      ),
      max_bytes: Type.Optional(
        Type.Integer({
          description:
            "Max bytes of output before truncation (default: 200000)",
        })
      ),
      max_lines: Type.Optional(
        Type.Integer({
          description:
            "Max lines of output before truncation (default: 5000)",
        })
      ),
      truncate_strategy: Type.Optional(
        StringEnum(["head", "tail"] as const, {
          description:
            "When truncating, keep the head (beginning) or tail (end). Default: head",
        })
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const {
        url,
        method = "GET",
        headers: rawHeaders,
        body,
        follow_redirects = true,
        strip = "html2md",
        max_bytes = DEFAULT_MAX_BYTES,
        max_lines = DEFAULT_MAX_LINES,
        truncate_strategy = "head",
      } = params;

      // ── Validate URL ────────────────────────────────────────────
      const urlError = validateUrl(url);
      if (urlError) {
        return {
          content: [{ type: "text", text: `Error: ${urlError}` }],
          details: {},
          isError: true,
        };
      }

      // ── Build headers ───────────────────────────────────────────
      let customHeaders: Record<string, string> = {};
      if (rawHeaders) {
        try {
          customHeaders = JSON.parse(rawHeaders);
        } catch {
          return {
            content: [{ type: "text", text: "Error: invalid JSON in `headers`" }],
            details: {},
            isError: true,
          };
        }
      }

      const headers = buildHeaders(customHeaders);

      // ── Notify progress ─────────────────────────────────────────
      onUpdate?.({
        content: [{ type: "text", text: `Fetching ${url} ...` }],
      });

      // ── Execute fetch ───────────────────────────────────────────
      try {
        const result = await executeFetch({
          url,
          method,
          headers,
          body,
          followRedirects: follow_redirects,
          strip: strip as StripMode,
          signal,
        });

        // ── Truncate ──────────────────────────────────────────────
        const truncation =
          truncate_strategy === "tail"
            ? truncateTail(result.strippedText, { maxBytes: max_bytes, maxLines: max_lines })
            : truncateHead(result.strippedText, { maxBytes: max_bytes, maxLines: max_lines });

        // ── Build result text ─────────────────────────────────────
        const rawBytes = new TextEncoder().encode(result.rawText).length;
        const strippedBytes = new TextEncoder().encode(result.strippedText).length;
        const strippedLines = result.strippedText.split("\n").length;
        const isHtml = result.contentType.toLowerCase().includes("text/html");

        let output = `HTTP ${result.httpStatusCode} ${result.finalUrl}\n`;
        output += `Content-Type: ${result.contentType}\n`;
        output += `Raw size: ${formatSize(rawBytes)} (${result.rawText.length} chars)\n`;
        if (result.appliedStripMethod !== "none") {
          output += `Strip: ${result.appliedStripMethod} → ${formatSize(strippedBytes)} (${result.strippedText.length} chars)\n`;
        } else if (strip !== "none" && !isHtml) {
          output += `Strip: ${strip} (skipped, non-HTML content) → ${formatSize(strippedBytes)} (${result.strippedText.length} chars)\n`;
        }
        output += `Lines: ${strippedLines}\n`;

        // ── Response headers ──────────────────────────────────────
        output += `\nResponse Headers:\n`;
        for (const { key, value } of result.headers) {
          output += `  ${key}: ${value}\n`;
        }

        output += "---\n";
        output += truncation.content;

        if (truncation.truncated) {
          output += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
        }

        return {
          content: [{ type: "text", text: output }],
          details: {
            url,
            finalUrl: result.finalUrl,
            httpStatusCode: result.httpStatusCode,
            headers: result.headers,
            contentType: result.contentType,
            requestedStripMethod: result.requestedStripMethod,
            appliedStripMethod: result.appliedStripMethod,
            rawBytes,
            strippedBytes,
            strippedLines,
            truncated: truncation.truncated,
            outputLines: truncation.outputLines,
          },
          isError: result.isError,
        };
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        return {
          content: [
            {
              type: "text",
              text: `Error fetching ${url}\n\n${msg}`,
            },
          ],
          details: {},
          isError: true,
        };
      }
    },
  });

  // ── in_page_search tool ─────────────────────────────────────────
  pi.registerTool({
    name: "in_page_search",
    label: "In-Page Search",
    description:
      "Search a webpage for a substring and return surrounding context. " +
      "Fetches the page, decodes HTML entities, finds all occurrences of " +
      "the search string, extracts context with proper HTML tag boundary " +
      "awareness, applies the chosen strip mode, and returns trimmed results. " +
      "Most common usage: find a link on a page by its visible text.",
    promptSnippet:
      "Search a webpage for text and return surrounding context",
    promptGuidelines: [
      "Use in_page_search when the user wants to find specific text on a webpage.",
      "Common scenario: find a link by its visible text to get the href.",
      "The search is case-insensitive and handles HTML-encoded entities.",
      "Use strip=html2md for readable Markdown context, strip=tags for plain text.",
      "Use strip=none if you need the raw HTML around the match (e.g., to extract href attributes).",
    ],

    parameters: Type.Object({
      url: Type.String({
        description: "The URL to search (e.g. https://example.com)",
      }),
      search: Type.String({
        description:
          "The substring to search for. Matches are case-insensitive. " +
          "HTML entities in the page are decoded before searching, so " +
          '"Click here" will match "Click&nbsp;here" in the HTML source.',
      }),
      context_limit: Type.Optional(
        Type.Integer({
          description:
            "Number of characters of context to return before and after " +
            "the match (default: 100).",
        })
      ),
      strip: Type.Optional(
        StringEnum(["html2md", "tags", "attributes", "whitespace", "none"] as const, {
          description:
            "Strip mode for the returned context. `html2md` (default) converts " +
            "to Markdown. `tags` returns plain text. `none` returns raw HTML " +
            "(useful for extracting href attributes from links).",
        })
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const {
        url,
        search,
        context_limit = DEFAULT_CONTEXT_LIMIT,
        strip = "html2md",
      } = params;

      // ── Validate URL ────────────────────────────────────────────
      const urlError = validateUrl(url);
      if (urlError) {
        return {
          content: [{ type: "text", text: `Error: ${urlError}` }],
          details: {},
          isError: true,
        };
      }

      if (!search || typeof search !== "string" || search.trim() === "") {
        return {
          content: [{ type: "text", text: "Error: `search` must be a non-empty string" }],
          details: {},
          isError: true,
        };
      }

      // ── Execute search ──────────────────────────────────────────
      try {
        const result = await inPageSearch(
          { url, search, context_limit, strip },
          signal,
          onUpdate,
        );

        if (result.isError) {
          return {
            content: [{
              type: "text",
              text: `HTTP ${result.status} — ${result.finalUrl}\nContent-Type: ${result.contentType}`,
            }],
            details: result,
            isError: true,
          };
        }

        if (result.results.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No matches found for "${search}" on ${result.finalUrl}\n\nHTTP ${result.status}\nContent-Type: ${result.contentType}\nRaw size: ${formatSize(result.rawBytes)}`,
            }],
            details: {
              url,
              finalUrl: result.finalUrl,
              status: result.status,
              search,
              matches: 0,
            },
            isError: false,
          };
        }

        // ── Format output ─────────────────────────────────────────
        const header = `Found ${result.results.length} match${result.results.length > 1 ? "es" : ""} for "${search}" on ${result.finalUrl}\n`;
        const body = result.results
          .map(
            (r) =>
              `--- Match ${r.matchIndex} of ${r.totalMatches} ---\n${r.snippet}`,
          )
          .join("\n\n");

        return {
          content: [{ type: "text", text: header + body }],
          details: {
            url,
            finalUrl: result.finalUrl,
            status: result.status,
            contentType: result.contentType,
            search,
            matches: result.results.length,
            strip,
            contextLimit: context_limit,
          },
          isError: false,
        };
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        return {
          content: [{ type: "text", text: `Error: ${msg}` }],
          details: {},
          isError: true,
        };
      }
    },
  });

  // ── raw_http_request tool ────────────────────────────────────────
  pi.registerTool({
    name: "raw_http_request",
    label: "Raw HTTP Request",
    description:
      "Send a raw HTTP request with no content stripping or transformation. " +
      "Returns the unaltered response body, headers, and status code. " +
      "Supports file body input, file response output, SSL skipping, " +
      "timeouts, and response size limits.",
    promptSnippet:
      "Send raw HTTP requests (no stripping, file I/O, size limits)",
    promptGuidelines: [
      "Use raw_http_request for raw, unaltered HTTP requests.",
      "Use http_request_body for inline body text or http_request_body_file to send a file's contents.",
      "Use http_response_body_file to write the response to a file instead of returning it.",
      "Set http_response_body_size_limit to cap response size in bytes.",
      "WARNING: Setting http_verify_ssl to false disables SSL certificate verification, " +
      "which makes the connection vulnerable to man-in-the-middle attacks. " +
      "Only use this for trusted internal/testing environments. " +
      "In production, always keep SSL verification enabled.",
    ],

    parameters: Type.Object({
      http_url: Type.String({
        description:
          "URL of the request (include query params here if any)",
      }),
      http_verify_ssl: Type.Optional(
        Type.Boolean({
          description:
            "Whether to verify SSL certificates (default: true). " +
            "WARNING: Disabling SSL verification exposes the connection to " +
            "man-in-the-middle attacks. Only disable in trusted testing environments.",
        })
      ),
      http_method: Type.Optional(
        Type.String({
          description:
            "HTTP method to use (default: GET). E.g. POST, PUT, DELETE",
        })
      ),
      http_request_body: Type.Optional(
        Type.String({
          description:
            "Request body to send (optional, use instead of http_request_body_file)",
        })
      ),
      http_request_body_file: Type.Optional(
        Type.String({
          description:
            "Filename to read request body from (optional, alternative to http_request_body)",
        })
      ),
      http_request_headers: Type.Optional(
        Type.String({
          description:
            "Request headers as a JSON string, e.g. '{\"Content-Type\":\"application/json\"}'",
        })
      ),
      http_request_timeout: Type.Optional(
        Type.Integer({
          description:
            "Request timeout in seconds (default: 30, max: 120)",
        })
      ),
      http_response_body_file: Type.Optional(
        Type.String({
          description:
            "Filename to write response body to (optional, response body will be empty when set)",
        })
      ),
      http_response_body_size_limit: Type.Optional(
        Type.Integer({
          description:
            "Max response body size in bytes (tool will error if exceeded)",
        })
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const {
        http_url,
        http_verify_ssl = true,
        http_method = "GET",
        http_request_body,
        http_request_body_file,
        http_request_headers: rawHeaders,
        http_request_timeout = DEFAULT_RAW_TIMEOUT,
        http_response_body_file,
        http_response_body_size_limit,
      } = params;

      // ── Build headers from JSON string ───────────────────────────
      let customHeaders: Record<string, string> = {};
      if (rawHeaders) {
        try {
          customHeaders = JSON.parse(rawHeaders);
        } catch {
          return {
            content: [{
              type: "text",
              text: "Error: invalid JSON in `http_request_headers`",
            }],
            details: {},
            isError: true,
          };
        }
      }

      // ── Notify progress ──────────────────────────────────────────
      onUpdate?.({
        content: [{ type: "text", text: `Fetching ${http_url} ...` }],
      });

      // ── Build params ─────────────────────────────────────────────
      const requestParams: RawRequestParams = {
        http_url,
        http_method,
        http_request_body,
        http_request_body_file,
        http_request_headers: customHeaders,
        http_request_timeout,
        http_verify_ssl,
        http_response_body_file,
        http_response_body_size_limit,
      };

      // ── Execute ──────────────────────────────────────────────────
      try {
        const result = await executeRawRequest(requestParams, signal);

        // ── Format output ──────────────────────────────────────────
        let output = `HTTP ${result.http_response_code}\n`;
        output += `Method: ${http_method}\n`;
        output += `URL: ${http_url}\n`;

        if (result.http_response_body_file) {
          output += `Response written to: ${result.http_response_body_file}\n`;
        } else if (result.http_response_body) {
          const bodyBytes = new TextEncoder()
            .encode(result.http_response_body).length;
          output += `Body size: ${formatSize(bodyBytes)} bytes\n`;
          output += `---\n${result.http_response_body}`;
        }

        // ── Response headers ───────────────────────────────────────
        if (result.http_response_headers.length > 0) {
          output += `\n\nResponse Headers:\n`;
          for (const { key, value } of result.http_response_headers) {
            output += `  ${key}: ${value}\n`;
          }
        }

        if (result.error) {
          output += `\nError: ${result.error}\n`;
        }

        return {
          content: [{ type: "text", text: output }],
          details: result,
          isError: result.error !== null,
        };
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        return {
          content: [{
            type: "text",
            text: `Error: ${msg}`,
          }],
          details: {},
          isError: true,
        };
      }
    },
  });
}
