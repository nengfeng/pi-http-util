/**
 * http_fetch — Fetch any URL from the internet.
 *
 * Pretends to be a generic Chromium browser via User-Agent.
 * Supports content stripping (whitespace normalization, attribute removal,
 * tag removal) and configurable length limits.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { truncateHead, truncateTail, formatSize } from "@earendil-works/pi-coding-agent";
import { stripNone, stripWhitespace, stripAttributes, stripTags, stripHtmlToMd } from "./strip";
import { inPageSearch } from "./in_page_search";

// ── Chrome User-Agent (generic, non-fingerprinting) ──────────────────
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// ── Defaults ─────────────────────────────────────────────────────────
const DEFAULT_MAX_BYTES = 200_000;   // ~40k tokens for web content
const DEFAULT_MAX_LINES = 5_000;
const DEFAULT_CONTEXT_LIMIT = 100;   // chars of context around a match

// ── URL Validation ───────────────────────────────────────────────────

/**
 * Validate a URL string. Returns an error message if invalid, null if ok.
 */
function validateUrl(url: string): string | null {
  if (!url || typeof url !== "string") {
    return "URL is required and must be a non-empty string";
  }
  try {
    new URL(url);
    return null;
  } catch {
    return `Invalid URL: "${url}". Must be a valid URL (e.g. https://example.com)`;
  }
}

// ── Tool ─────────────────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "http_fetch",
    label: "HTTP Fetch",
    description:
      "Fetch a URL from the internet. Pretends to be a Chromium browser. " +
      "Supports content stripping via the `strip` parameter and configurable " +
      "length limits. Use `strip` to clean up HTML: `html2md` (default, convert " +
      "HTML to Markdown with headings, bold, links, lists, etc.), `tags` (remove " +
      "HTML tags + decode entities + collapse whitespace), `attributes` (remove " +
      "HTML attributes + collapse whitespace), `none` (raw content). Use " +
      "`max_bytes` and `max_lines` to cap output size. Truncation strategy: " +
      "`head` keeps the beginning, `tail` keeps the end.",
    promptSnippet: "Fetch web pages via HTTP (Chromium UA, strip mode, truncation)",
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
      const headers: Record<string, string> = {
        "User-Agent": CHROME_UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9," +
          "image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      };

      if (rawHeaders) {
        try {
          Object.assign(headers, JSON.parse(rawHeaders));
        } catch {
          return {
            content: [{ type: "text", text: "Error: invalid JSON in `headers`" }],
            details: {},
            isError: true,
          };
        }
      }

      // ── Build fetch options ─────────────────────────────────────
      const fetchOptions: RequestInit = {
        method,
        headers,
        redirect: follow_redirects ? "follow" : "manual",
        signal,
      };

      if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
        fetchOptions.body = body;
        if (!headers["Content-Type"]) {
          headers["Content-Type"] = "text/plain; charset=utf-8";
        }
      }

      // ── Fetch ───────────────────────────────────────────────────
      let responseText: string;
      let finalUrl: string;
      let status: number;
      let contentType: string;

      try {
        onUpdate?.({
          content: [{ type: "text", text: `Fetching ${url} ...` }],
        });

        const res = await fetch(url, fetchOptions);
        finalUrl = res.url;
        status = res.status;
        contentType = res.headers.get("Content-Type") ?? "unknown";

        // Read as text (handles gzip/br automatically via undici)
        responseText = await res.text();
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

      // ── Check for HTTP error status ─────────────────────────────
      const isError = status >= 400;

      // ── Apply strip mode ────────────────────────────────────────
      const stripFns: Record<string, (s: string) => string> = {
        none: stripNone,
        whitespace: stripWhitespace,
        attributes: stripAttributes,
        tags: stripTags,
        html2md: stripHtmlToMd,
      };

      const stripFn = stripFns[strip] ?? stripNone;
      const strippedText = stripFn(responseText);

      // ── Truncate ────────────────────────────────────────────────
      const truncation =
        truncate_strategy === "tail"
          ? truncateTail(strippedText, { maxBytes: max_bytes, maxLines: max_lines })
          : truncateHead(strippedText, { maxBytes: max_bytes, maxLines: max_lines });

      let output = truncation.content;

      // ── Build result ────────────────────────────────────────────
      const rawBytes = new TextEncoder().encode(responseText).length;
      const strippedBytes = new TextEncoder().encode(strippedText).length;
      const strippedLines = strippedText.split("\n").length;

      let result = `HTTP ${status} ${finalUrl}\n`;
      result += `Content-Type: ${contentType}\n`;
      result += `Raw size: ${formatSize(rawBytes)} (${responseText.length} chars)\n`;
      if (strip !== "none") {
        result += `Strip: ${strip} → ${formatSize(strippedBytes)} (${strippedText.length} chars)\n`;
      }
      result += `Lines: ${strippedLines}\n`;
      result += "---\n";
      result += output;

      if (truncation.truncated) {
        result += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
      }

      return {
        content: [{ type: "text", text: result }],
        details: {
          url,
          finalUrl,
          status,
          contentType,
          strip,
          rawBytes,
          strippedBytes,
          strippedLines,
          truncated: truncation.truncated,
          outputLines: truncation.outputLines,
        },
        isError,
      };
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
}
