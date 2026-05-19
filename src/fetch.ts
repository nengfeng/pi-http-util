/**
 * fetch.ts — Pure fetch + strip logic for http_fetch tool.
 *
 * Extracted so it can be unit-tested without depending on
 * typebox / pi-ai (which are only needed for tool registration).
 * Truncation and final text formatting are handled by the tool layer.
 */

import { resolveStripMethod, applyStrip, type StripMode } from "./strip.ts";
import { globalRateLimiter } from "./rate_limiter.ts";

// ── Project User-Agent ──────────────────────────────────────────────
const PROJECT_UA = "pi-http-util/1.2.0";

// ── Defaults ─────────────────────────────────────────────────────────
export const DEFAULT_MAX_BYTES = 200_000;
export const DEFAULT_MAX_LINES = 5_000;

export interface FetchParams {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  followRedirects: boolean;
  strip: StripMode;
  signal?: AbortSignal;
}

export interface FetchResult {
  finalUrl: string;
  httpStatusCode: number;
  headers: { key: string; value: string }[];
  contentType: string;
  requestedStripMethod: StripMode;
  appliedStripMethod: StripMode;
  rawText: string;
  strippedText: string;
  isError: boolean;
}

/**
 * Check if a hostname is a private/internal IP address.
 * Blocks: loopback (127.0.0.0/8), link-local (169.254.0.0/16),
 * private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16),
 * and IPv6 loopback (::1, fc00::/7).
 */
function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // IPv6 loopback and unique local
  if (lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd")) {
    return true;
  }

  // IPv4 checks
  const parts = lower.split(".");
  if (parts.length !== 4) {
    // Could be IPv6 or hostname — let DNS resolution handle hostnames
    return false;
  }

  const octets = parts.map(Number);
  if (octets.some((n) => isNaN(n) || n < 0 || n > 255)) {
    return false;
  }

  const [a, b, c, d] = octets;

  // 127.0.0.0/8 loopback
  if (a === 127) return true;
  // 10.0.0.0/8 private
  if (a === 10) return true;
  // 172.16.0.0/12 private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 private
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 link-local
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8
  if (a === 0) return true;

  return false;
}

let allowPrivateHosts = false;

/** Allow private/internal hostnames in URL validation (for testing). */
export function setAllowPrivateHosts(allow: boolean): void {
  allowPrivateHosts = allow;
}

/**
 * Validate a URL string. Returns an error message if invalid, null if ok.
 * Enforces http/https protocol and blocks private/internal IP addresses.
 */
export function validateUrl(url: string): string | null {
  if (!url || typeof url !== "string") {
    return "URL is required and must be a non-empty string";
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Invalid URL: "${url}". Must be a valid URL (e.g. https://example.com)`;
  }

  // Only allow http and https protocols
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `Invalid protocol: "${parsed.protocol}". Only http: and https: are allowed`;
  }

  // Block private/internal IP addresses to prevent SSRF
  if (!allowPrivateHosts && isPrivateHost(parsed.hostname)) {
    return `Access to internal/private address "${parsed.hostname}" is blocked`;
  }

  return null;
}

/**
 * Build the default browser-like headers, merged with any custom headers.
 */
export function buildHeaders(customHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": PROJECT_UA,
    Accept: "*/*",
  };

  if (customHeaders) {
    Object.assign(headers, customHeaders);
  }

  return headers;
}

/**
 * Execute the fetch + strip pipeline. Returns raw data for the tool
 * to format, truncate, and present.
 */
export async function executeFetch(params: FetchParams): Promise<FetchResult> {
  const { url, method, headers, body, followRedirects, strip, signal } = params;

  // ── Rate limiting ──────────────────────────────────────────────
  if (!globalRateLimiter.tryAcquire()) {
    const waitSec = Math.ceil(globalRateLimiter.waitMs / 1000);
    return {
      finalUrl: url,
      httpStatusCode: 429,
      headers: [],
      contentType: "",
      requestedStripMethod: strip,
      appliedStripMethod: strip,
      rawText: "",
      strippedText: "",
      isError: true,
    };
  }

  // ── Build fetch options ─────────────────────────────────────────
  const fetchOptions: RequestInit = {
    method,
    headers,
    redirect: followRedirects ? "follow" : "manual",
    signal,
  };

  if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
    fetchOptions.body = body;
    // Clone headers to avoid mutating the caller's object
    if (!headers["Content-Type"]) {
      fetchOptions.headers = { ...headers, "Content-Type": "text/plain; charset=utf-8" };
    }
  }

  // ── Fetch ───────────────────────────────────────────────────────
  const res = await fetch(url, fetchOptions);

  const finalUrl = res.url;

  // Re-validate the final URL after redirects to prevent SSRF bypass
  if (finalUrl && finalUrl !== url) {
    const redirectError = validateUrl(finalUrl);
    if (redirectError) {
      return {
        finalUrl,
        httpStatusCode: 0,
        headers: [],
        contentType: "",
        requestedStripMethod: strip,
        appliedStripMethod: strip,
        rawText: "",
        strippedText: "",
        isError: true,
      };
    }
  }

  const status = res.status;
  const contentType = res.headers.get("Content-Type") ?? "unknown";

  // Collect response headers
  const responseHeaders: { key: string; value: string }[] = [];
  for (const [key, value] of res.headers.entries()) {
    responseHeaders.push({ key, value });
  }

  // Check Content-Type before reading body
  const responseContentType = res.headers.get("Content-Type") ?? "";
  const isTextContent = /^(text\/|application\/(json|xml|xhtml\+xml|javascript)|application\/x-www-form-urlencoded)/i.test(responseContentType);

  let rawText: string;
  if (!isTextContent) {
    // For non-text content, return a placeholder with size info
    const contentLength = res.headers.get("Content-Length");
    const sizeHint = contentLength ? `${contentLength} bytes` : "unknown size";
    rawText = `[Binary content: ${responseContentType || "unknown type"}, ${sizeHint}. Use raw_http_request for binary downloads.]`;
  } else {
    // Read as text (handles gzip/br automatically via undici)
    rawText = await res.text();
  }

  // ── Apply strip mode (fallback to none for non-HTML) ────────────
  const appliedStrip = resolveStripMethod(strip, contentType);
  const strippedText = applyStrip(rawText, appliedStrip);

  return {
    finalUrl,
    httpStatusCode: status,
    headers: responseHeaders,
    contentType,
    requestedStripMethod: strip,
    appliedStripMethod: appliedStrip,
    rawText,
    strippedText,
    isError: status >= 400,
  };
}
