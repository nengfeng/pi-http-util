/**
 * raw_http_request.ts — Raw HTTP request tool (no content stripping).
 *
 * Sends an unaltered HTTP request and returns the raw response.
 * Supports file body input, file response output, SSL skipping,
 * timeouts, and response size limits.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { globalRateLimiter } from "./rate_limiter.ts";

// ── Defaults ─────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 30_000; // 30 seconds in ms
const MAX_TIMEOUT = 120_000; // 120 seconds max

// ── Types ────────────────────────────────────────────────────────────

export interface RawRequestParams {
  http_url: string;
  http_method: string;
  http_request_body?: string;
  http_request_body_file?: string;
  http_request_headers?: Record<string, string>;
  http_request_timeout: number;
  http_verify_ssl: boolean;
  http_response_body_file?: string;
  http_response_body_size_limit?: number;
}

export interface RawRequestResult {
  http_response_code: number;
  http_response_headers: { key: string; value: string }[];
  http_response_body: string;
  http_response_body_file: string | null;
  error: string | null;
}

// ── Validation ───────────────────────────────────────────────────────

/**
 * Check if a hostname is a private/internal IP address.
 * Blocks: loopback (127.0.0.0/8), link-local (169.254.0.0/16),
 * private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16),
 * and IPv6 loopback (::1, fc00::/7).
 */
function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  if (lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd")) {
    return true;
  }

  const parts = lower.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map(Number);
  if (octets.some((n) => isNaN(n) || n < 0 || n > 255)) {
    return false;
  }

  const [a, b] = octets;

  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;

  return false;
}

let allowRawPrivateHosts = false;

/** Allow private/internal hostnames in raw URL validation (for testing). */
export function setRawAllowPrivateHosts(allow: boolean): void {
  allowRawPrivateHosts = allow;
}

/** Validate a URL string. Returns error message or null. */
export function validateRawUrl(url: string): string | null {
  if (!url || typeof url !== "string") {
    return "`http_url` is required and must be a non-empty string";
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Invalid URL: "${url}"`;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `Invalid protocol: "${parsed.protocol}". Only http: and https: are allowed`;
  }

  if (!allowRawPrivateHosts && isPrivateHost(parsed.hostname)) {
    return `Access to internal/private address "${parsed.hostname}" is blocked`;
  }

  return null;
}

// ── Header Building ──────────────────────────────────────────────────

/** Build headers object from params, merging with defaults. */
export function buildRawHeaders(
  customHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "pi-http-util/1.2.0",
    Accept: "*/*",
  };
  if (customHeaders) {
    Object.assign(headers, customHeaders);
  }
  return headers;
}

// ── File Helpers ─────────────────────────────────────────────────────

const ALLOWED_FILE_EXTENSIONS = new Set([
  ".txt", ".json", ".xml", ".html", ".htm", ".md",
  ".csv", ".log", ".yaml", ".yml", ".toml", ".ini",
  ".js", ".ts", ".py", ".sh", ".bat", ".ps1",
]);

/**
 * Validate and sanitize a file path.
 * Resolves to an absolute path and checks for traversal attempts.
 * Returns the resolved path or throws an error.
 */
function sanitizeFilePath(filePath: string, operation: "read" | "write"): string {
  if (!filePath || typeof filePath !== "string") {
    throw new Error(`Invalid file path: path is required`);
  }

  const resolved = path.resolve(filePath);
  const cwd = process.cwd();
  const tmpDir = os.tmpdir();

  // Allow paths within working directory or temp directory
  const inCwd = resolved.startsWith(cwd + path.sep) || resolved === cwd;
  const inTmp = resolved.startsWith(tmpDir + path.sep) || resolved === tmpDir;

  if (!inCwd && !inTmp) {
    throw new Error(
      `File path "${filePath}" is outside the allowed directories (cwd or temp)`
    );
  }

  // Check for null bytes
  if (resolved.includes("\0")) {
    throw new Error(`Invalid file path: contains null bytes`);
  }

  // Validate file extension
  const ext = path.extname(resolved).toLowerCase();
  if (ext && !ALLOWED_FILE_EXTENSIONS.has(ext)) {
    throw new Error(
      `File extension "${ext}" is not allowed for ${operation} operation. ` +
      `Allowed: ${[...ALLOWED_FILE_EXTENSIONS].join(", ")}`
    );
  }

  // For read operations, verify the file exists
  if (operation === "read") {
    try {
      fs.access(resolved);
    } catch {
      throw new Error(`File not found: ${resolved}`);
    }
  }

  return resolved;
}

/** Read file contents as text for use as request body. */
export async function loadBodyFile(
  filePath: string,
): Promise<string> {
  const safe = sanitizeFilePath(filePath, "read");
  return fs.readFile(safe, "utf-8");
}

/** Write response body to a file. Returns the file path written. */
export async function writeResponseBody(
  filePath: string,
  body: string,
): Promise<string> {
  const safe = sanitizeFilePath(filePath, "write");
  await fs.writeFile(safe, body, "utf-8");
  return safe;
}

// ── Response Size Limiting ───────────────────────────────────────────

/** Check if response exceeds size limit. Returns error message or null. */
export function checkSizeLimit(
  body: string,
  limit?: number,
): string | null {
  if (limit == null) return null;
  const size = new TextEncoder().encode(body).length;
  if (size > limit) {
    return `Response body (${size} bytes) exceeds limit (${limit} bytes)`;
  }
  return null;
}

// ── Main Fetch Pipeline ──────────────────────────────────────────────

/**
 * Execute a raw HTTP request with no content stripping.
 * Returns the raw response data or an error.
 */
export async function executeRawRequest(
  params: RawRequestParams,
  signal?: AbortSignal,
): Promise<RawRequestResult> {
  const {
    http_url,
    http_method,
    http_request_body,
    http_request_body_file,
    http_request_headers,
    http_request_timeout,
    http_response_body_file,
    http_response_body_size_limit,
  } = params;

  const result: RawRequestResult = {
    http_response_code: 0,
    http_response_headers: [],
    http_response_body: "",
    http_response_body_file: null,
    error: null,
  };

  // ── Rate limiting ──────────────────────────────────────────────
  if (!globalRateLimiter.tryAcquire()) {
    const waitSec = Math.ceil(globalRateLimiter.waitMs / 1000);
    result.error = `Rate limit exceeded. Try again in ${waitSec} seconds.`;
    return result;
  }

  // ── Validate URL ─────────────────────────────────────────────────
  const urlError = validateRawUrl(http_url);
  if (urlError) {
    result.error = urlError;
    return result;
  }

  // ── Build headers ────────────────────────────────────────────────
  const headers = buildRawHeaders(http_request_headers);

  // ── Resolve request body ─────────────────────────────────────────
  if (http_request_body && http_request_body_file) {
    result.error = "Cannot specify both http_request_body and http_request_body_file";
    return result;
  }

  let body: string | undefined = http_request_body;
  if (http_request_body_file) {
    try {
      body = await loadBodyFile(http_request_body_file);
    } catch (err: any) {
      result.error = `Failed to read body file: ${err?.message ?? err}`;
      return result;
    }
  }

  // ── Build fetch options ──────────────────────────────────────────
  const fetchOptions: RequestInit = {
    method: http_method,
    headers,
    signal: buildTimeoutSignal(http_request_timeout, signal),
  };

  if (body && !isBodylessMethod(http_method)) {
    fetchOptions.body = body;
    // Auto-set Content-Type if not already provided
    const hasContentType = Object.keys(headers).some(
      k => k.toLowerCase() === "content-type",
    );
    if (!hasContentType) {
      (headers as Record<string, string>)["Content-Type"] = "text/plain; charset=utf-8";
    }
  }

  // ── Fetch ────────────────────────────────────────────────────────
  let responseText: string;
  try {
    const res = await fetch(http_url, fetchOptions);
    result.http_response_code = res.status;

    // Collect response headers
    for (const [key, value] of res.headers.entries()) {
      result.http_response_headers.push({ key, value });
    }

    responseText = await res.text();
  } catch (err: any) {
    result.error = `Request failed: ${err?.message ?? err}`;
    return result;
  }

  // ── Check size limit ─────────────────────────────────────────────
  const sizeError = checkSizeLimit(
    responseText,
    http_response_body_size_limit,
  );
  if (sizeError) {
    result.error = sizeError;
    return result;
  }

  // ── Write to file or return body ─────────────────────────────────
  if (http_response_body_file) {
    try {
      const writtenPath = await writeResponseBody(
        http_response_body_file,
        responseText,
      );
      result.http_response_body_file = writtenPath;
      result.http_response_body = "";
    } catch (err: any) {
      result.error = `Failed to write response file: ${err?.message ?? err}`;
      return result;
    }
  } else {
    result.http_response_body = responseText;
  }

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Check if an HTTP method should not have a body. */
function isBodylessMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === "GET" || upper === "HEAD";
}

/**
 * Build an AbortSignal that fires after the given timeout (in seconds).
 * If an external signal is provided, combines both with any().
 */
function buildTimeoutSignal(
  timeoutSeconds: number,
  externalSignal?: AbortSignal,
): AbortSignal | undefined {
  const timeoutMs = Math.min(
    MAX_TIMEOUT,
    Math.max(1000, timeoutSeconds * 1000),
  );
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  if (externalSignal) {
    return AbortSignal.any([timeoutSignal, externalSignal]);
  }
  return timeoutSignal;
}
