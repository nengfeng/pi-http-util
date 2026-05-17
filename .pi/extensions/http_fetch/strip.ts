/**
 * strip.ts — HTML content strip modes.
 *
 * Pure functions for transforming HTML content:
 * - stripNone: identity (no transformation)
 * - stripWhitespace: collapse multi-whitespace to single space
 * - stripAttributes: remove HTML attributes, collapse whitespace
 * - stripTags: remove all HTML tags, decode entities, collapse whitespace
 * - stripHtmlToMd: convert HTML to Markdown
 *
 * All functions are side-effect-free and fully unit-testable.
 */

import { tokenize, type Token } from "./tokenizer.ts";
import { decodeTextEntities } from "./entities.ts";
import { isHtmlWhitespace, collapseWhitespace } from "./whitespace.ts";

// ── Module-level constants ───────────────────────────────────────────

/** Elements whose content should be skipped entirely. */
const SKIP_ELEMENTS = new Set([
  "script", "style", "head", "meta", "link", "title", "noscript",
]);

/** Generic block-level elements. */
const BLOCK_ELEMENTS = new Set([
  "div", "section", "article", "aside", "main", "nav", "footer", "header",
]);

/** Common CSS class names that indicate UI chrome to skip. */
const CHROME_CLASSES = new Set([
  "cookieOverlay", "cookie-overlay", "modal", "modal-backdrop",
  "nosnippet", "data-nosnippet",
]);

// ── Utility ──────────────────────────────────────────────────────────

/** Get an attribute value from a tag token by name (case-insensitive). */
export function getAttr(token: Extract<Token, { kind: "tag" }>, name: string): string | null {
  const attr = token.attributes.find(a => a.name.toLowerCase() === name);
  return attr?.value ?? null;
}

/** Get an attribute value with HTML entities decoded. */
export function getAttrDecoded(token: Extract<Token, { kind: "tag" }>, name: string): string | null {
  const val = getAttr(token, name);
  return val !== null ? decodeTextEntities(val) : null;
}

/**
 * Check if a tag should be skipped due to semantic hints like
 * data-nosnippet, aria-hidden, or known UI chrome class names.
 */
function shouldSkipChrome(token: Extract<Token, { kind: "tag" }>): boolean {
  // data-nosnippet
  if (getAttr(token, "data-nosnippet") !== null) return true;
  // aria-hidden="true"
  if (getAttr(token, "aria-hidden") === "true") return true;
  // Known chrome class names
  const cls = getAttr(token, "class");
  if (cls) {
    const classes = cls.split(/\s+/);
    for (const c of classes) {
      if (CHROME_CLASSES.has(c.toLowerCase())) return true;
    }
  }
  return false;
}

/**
 * Strip framework template expressions (AngularJS {{...}}, Vue {{...}}, etc.)
 * from text content.
 */
function stripTemplateExpressions(text: string): string {
  return text.replace(/\{\{[^}]*\}\}/g, "").replace(/\{#[^#]*#\}/g, "");
}

/**
 * Resolve a potentially relative URL against a base URL.
 * Handles protocol-relative (//host), root-relative (/path), and absolute URLs.
 */
function resolveUrl(href: string, baseUrl: string | null): string {
  if (!baseUrl) return href;
  // Already absolute
  if (/^https?:\/\//i.test(href)) return href;
  // Protocol-relative
  if (href.startsWith("//")) {
    const proto = baseUrl.match(/^(https?:)\/\//);
    return (proto ? proto[1] : "https:") + href;
  }
  // Root-relative
  if (href.startsWith("/")) {
    const origin = baseUrl.match(/^(https?:\/\/[^/]+)/);
    return origin ? origin[1] + href : href;
  }
  // Relative — append to base directory
  const baseDir = baseUrl.lastIndexOf("/");
  return baseDir >= 0 ? baseUrl.slice(0, baseDir + 1) + href : href;
}

// ── Strip Modes ──────────────────────────────────────────────────────

/** Strip mode: "none" — no transformation. */
export function stripNone(text: string): string {
  return text;
}

/** Strip mode: "whitespace" — collapse multi-whitespace to single space. */
export function stripWhitespace(text: string): string {
  return collapseWhitespace(text);
}

/** Strip mode: "attributes" — remove HTML attributes, then collapse whitespace. */
export function stripAttributes(html: string): string {
  let output = "";
  for (const token of tokenize(html)) {
    if (token.kind === "text") {
      output += token.data;
    } else if (token.kind === "comment") {
      output += `<!--${token.data}-->`;
    } else if (token.kind === "doctype") {
      output += `<!DOCTYPE${token.data}>`;
    } else if (token.kind === "tag") {
      if (token.isClosing) {
        output += `</${token.name}>`;
      } else {
        output += `<${token.name}`;
        // Attributes are dropped — only keep self-closing /
        if (token.selfClosing) {
          output += "/";
        }
        output += ">";
      }
    }
  }
  return collapseWhitespace(output);
}

/** Strip mode: "tags" — remove all HTML tags, then collapse whitespace. */
export function stripTags(html: string): string {
  let output = "";
  let skipContent = false;   // inside <script>/<style> blocks
  let prevWasTag = false;    // was the last processed token a (non-script/style) tag?

  for (const token of tokenize(html)) {
    // Skip <script>/<style> open/close tags and their raw text content
    if (token.kind === "tag" && !token.isClosing && (token.name === "script" || token.name === "style")) {
      skipContent = true;
      continue;
    }
    if (token.kind === "tag" && token.isClosing && (token.name === "script" || token.name === "style")) {
      skipContent = false;
      continue;
    }
    if (skipContent) continue;

    if (token.kind === "text") {
      // When previous token was a stripped tag, insert a space to prevent
      // accidental word concatenation (e.g. <p>Bob</p>Marley → "Bob Marley")
      if (prevWasTag && output.length > 0 && !isHtmlWhitespace(output.at(-1)!)) {
        output += " ";
      }
      output += decodeTextEntities(token.data);
      prevWasTag = false;
    } else if (token.kind === "tag") {
      prevWasTag = true;
    }
    // Comments, doctypes, and other tags are dropped
  }
  return collapseWhitespace(output);
}

// ── HTML → Markdown ──────────────────────────────────────────────────

/**
 * Strip mode: "html2md" — convert HTML to Markdown, then collapse whitespace.
 *
 * Handles:
 * - Headings (h1-h6)
 * - Bold/strong, italic/em, strikethrough
 * - Links, images (including <picture>/<source>)
 * - Lists (ordered/unordered, nested)
 * - Code (inline and blocks)
 * - Blockquotes, horizontal rules
 * - Tables (basic, with <caption>)
 * - Paragraphs, line breaks
 * - Sub/superscript, abbreviation, mark/highlight
 * - <time>, <details>/<summary>, <figure>/<figcaption>
 * - Skips script/style/head/meta/title/noscript
 * - Skips elements with data-nosnippet, aria-hidden="true", known chrome classes
 * - Strips framework template expressions ({{...}})
 * - Resolves relative URLs against a base URL
 */
export function stripHtmlToMd(html: string): string {
  // ── State ────────────────────────────────────────────────────────
  const blockStack: string[] = [];          // open block element names
  const inlineStack: string[] = [];         // pending inline closing markers
  const listStack: { ordered: boolean; depth: number }[] = []; // open lists
  let inPre = false;                        // inside <pre> block
  let preContent = "";
  let inTable = false;                      // inside <table>
  let tableRows: string[] = [];
  let inTr = false;
  let currentTableCells: string[] = [];
  let tableHeaderDone = false;
  let tableCaption = "";                    // <caption> text
  let skipContent = false;                  // inside skip element
  let skipDepth = 0;
  let skipChromeDepth = 0;                  // depth inside chrome element
  let output = "";
  let noBlockSpacing = false;               // suppress next ensureBlockSpacing
  let lastWasHr = false;                    // track consecutive <hr>
  let inPicture = false;                    // inside <picture>
  let pictureSrc = "";
  let pictureAlt = "";
  let inFigure = false;
  let figcaptionText = "";
  let inDetails = false;
  let summaryText = "";
  let inNav = false;                        // inside <nav>
  let inSummary = false;
  let linkDeferred = false;                 // <a> wrapping block content — defer link
  let linkHref = "";                        // stored href for deferred link
  let linkContent = "";                     // accumulated content for deferred link
  let linkOutputStart = 0;                  // output length when deferred link opened

  // ── Emit helpers ─────────────────────────────────────────────────

  function ensureBlockSpacing() {
    if (noBlockSpacing) {
      noBlockSpacing = false;
      return;
    }
    if (output.length > 0 && !output.endsWith("\n\n") && !output.endsWith("\n")) {
      output += "\n\n";
    }
  }

  function closeInlineMarkers() {
    while (inlineStack.length > 0) {
      output += inlineStack.pop()!;
    }
  }

  function closeAllLists() {
    listStack.length = 0;
  }

  function emitListMarker(list: { ordered: boolean; depth: number }) {
    const indent = "  ".repeat(list.depth);
    if (list.ordered) {
      return indent + "1. ";
    }
    return indent + "- ";
  }

  function flushTable() {
    if (tableCaption) {
      ensureBlockSpacing();
      output += tableCaption + "\n\n";
      tableCaption = "";
    }
    if (tableRows.length > 0) {
      ensureBlockSpacing();
      for (const row of tableRows) {
        output += row + "\n";
      }
      tableRows.length = 0;
      tableHeaderDone = false;
    }
    inTable = false;
    inTr = false;
    currentTableCells.length = 0;
  }

  function flushPre() {
    if (preContent) {
      ensureBlockSpacing();
      output += "```\n" + preContent + "```\n\n";
      preContent = "";
    }
    inPre = false;
  }

  function flushPicture() {
    if (pictureSrc) {
      const alt = pictureAlt.replace(/\]/g, "\\]").replace(/\[/g, "\\[");
      closeInlineMarkers();
      output += `![${alt}](${pictureSrc})`;
    }
    inPicture = false;
    pictureSrc = "";
    pictureAlt = "";
  }

  function flushFigure() {
    flushPicture();
    if (figcaptionText.trim()) {
      output += `\n*${figcaptionText.trim()}*`;
    }
    inFigure = false;
    figcaptionText = "";
  }

  function flushDetails() {
    if (summaryText.trim()) {
      ensureBlockSpacing();
      output += `> **${summaryText.trim()}**\n> `;
      noBlockSpacing = true;
    }
    inDetails = false;
    inSummary = false;
    summaryText = "";
  }

  function flushBlock() {
    flushPre();
    closeInlineMarkers();
    closeAllLists();
    flushTable();
    flushPicture();
    flushFigure();
    flushDetails();
  }

  function flushDeferredLink(force: boolean = false) {
    if (!linkDeferred || !linkHref) {
      linkDeferred = false;
      linkHref = "";
      linkContent = "";
      linkOutputStart = 0;
      return;
    }
    // Gather content from both linkContent and the output slice
    const outputSlice = output.slice(linkOutputStart).trim();
    const combined = (linkContent.trim() + " " + outputSlice).trim();
    // If no content yet and not forced, keep deferred state alive
    if (!combined && !force) return;
    // Remove the captured slice from output
    output = output.slice(0, linkOutputStart);
    if (combined) {
      // Check if content starts with a heading marker → ## [Title](url)
      const headingMatch = combined.match(/^(#{1,6})\s+(.+)$/s);
      if (headingMatch) {
        output += `${headingMatch[1]} [${headingMatch[2].trim().replace(/\n+/g, ' ')}](${linkHref})\n\n`;
      } else if (combined.length < 500 && !combined.includes("\n\n") && !combined.includes("- ") && !combined.includes("1. ")) {
        // Simple short text (single paragraph, no lists) → [text](url)
        const normalized = combined.replace(/\n+/g, ' ');
        output += `[${normalized}](${linkHref})`;
        // Add block spacing after the link
        output += "\n\n";
      } else {
        // Complex content (lists, long text, multi-para) → drop link wrapper
        const normalized = combined.replace(/\n+/g, '\n\n');
        output += normalized;
        if (!normalized.endsWith("\n\n")) output += "\n\n";
      }
    }
    linkDeferred = false;
    linkHref = "";
    linkContent = "";
    linkOutputStart = 0;
  }

  // ── Process tokens ───────────────────────────────────────────────

  for (const token of tokenize(html)) {
    // ── Skip elements (script, style, head, meta, link, title, noscript) ──
    if (token.kind === "tag" && !token.isClosing && SKIP_ELEMENTS.has(token.name)) {
      skipContent = true;
      skipDepth = 1;
      continue;
    }
    if (skipContent) {
      if (token.kind === "tag" && !token.isClosing) skipDepth++;
      if (token.kind === "tag" && token.isClosing) {
        skipDepth--;
        if (skipDepth <= 0) skipContent = false;
      }
      continue;
    }

    // ── Skip UI chrome (data-nosnippet, aria-hidden, known classes) ─
    if (token.kind === "tag" && !token.isClosing && shouldSkipChrome(token)) {
      skipChromeDepth = 1;
      continue;
    }
    if (skipChromeDepth > 0) {
      if (token.kind === "tag" && !token.isClosing) skipChromeDepth++;
      if (token.kind === "tag" && token.isClosing) {
        skipChromeDepth--;
      }
      continue;
    }

    // Comments and doctypes are dropped
    if (token.kind === "comment" || token.kind === "doctype") continue;

    // ── Text ───────────────────────────────────────────────────────
    if (token.kind === "text") {
      let text = decodeTextEntities(token.data);
      // Strip framework template expressions
      text = stripTemplateExpressions(text);
      if (inPre) {
        preContent += text;
      } else if (inTable && inTr) {
        currentTableCells.push(text.trim());
      } else if (inSummary) {
        summaryText += text;
      } else if (inFigure && !inPicture) {
        // Could be figcaption text or other figure content
        figcaptionText += text;
      } else if (linkDeferred) {
        // Accumulate text for deferred link
        linkContent += text;
      } else {
        output += text;
      }
      continue;
    }

    // From here on, token is a tag
    const tag = token as Extract<Token, { kind: "tag" }>;

    // ── Opening tags ───────────────────────────────────────────────
    if (!tag.isClosing) {
      const name = tag.name;

      // ── Headings ─────────────────────────────────────────────────
      if (/^h[1-6]$/.test(name)) {
        // Don't flush deferred link — heading content is part of the link
        flushBlock();
        if (!linkDeferred) {
          ensureBlockSpacing();
        }
        const level = parseInt(name[1], 10);
        if (linkDeferred) {
          linkContent += "#".repeat(level) + " ";
        } else {
          output += "#".repeat(level) + " ";
        }
        blockStack.push(name);
        continue;
      }

      // ── Paragraph ────────────────────────────────────────────────
      if (name === "p") {
        flushPre();
        closeInlineMarkers();
        flushTable();
        flushPicture();
        flushFigure();
        // Don't add block spacing inside list items
        const insideLi = blockStack.includes("li");
        if (!insideLi && !linkDeferred) {
          ensureBlockSpacing();
        }
        blockStack.push("p");
        continue;
      }

      // ── Line break ───────────────────────────────────────────────
      if (name === "br") {
        closeInlineMarkers();
        output += "\n\n";
        continue;
      }

      // ── Horizontal rule (collapse consecutive) ───────────────────
      if (name === "hr") {
        if (lastWasHr) {
          lastWasHr = false;
          continue;
        }
        flushBlock();
        ensureBlockSpacing();
        output += "---\n\n";
        lastWasHr = true;
        continue;
      }

      // ── Pre / code blocks ────────────────────────────────────────
      if (name === "pre") {
        closeInlineMarkers();
        closeAllLists();
        flushTable();
        flushPicture();
        flushFigure();
        flushPre();
        ensureBlockSpacing();
        inPre = true;
        blockStack.push("pre");
        continue;
      }
      if (name === "code" && inPre) {
        // <code> inside <pre> — just pass through
        continue;
      }

      // ── Blockquote ───────────────────────────────────────────────
      if (name === "blockquote") {
        flushPre();
        closeInlineMarkers();
        flushTable();
        flushPicture();
        flushFigure();
        ensureBlockSpacing();
        output += "> ";
        noBlockSpacing = true;  // don't add spacing for first child
        blockStack.push("blockquote");
        continue;
      }

      // ── Tables ───────────────────────────────────────────────────
      if (name === "table") {
        flushPre();
        closeInlineMarkers();
        flushTable();
        flushPicture();
        flushFigure();
        ensureBlockSpacing();
        inTable = true;
        blockStack.push("table");
        continue;
      }
      if (name === "caption") {
        // Capture caption text for output before the table
        continue;
      }
      if (name === "thead" || name === "tbody" || name === "tfoot") {
        continue;
      }
      if (name === "tr") {
        inTr = true;
        currentTableCells.length = 0;
        continue;
      }
      if (name === "th" || name === "td") {
        continue;
      }

      // ── Lists ────────────────────────────────────────────────────
      if (name === "ul" || name === "ol") {
        flushDeferredLink();
        flushPre();
        closeInlineMarkers();
        flushTable();
        flushPicture();
        flushFigure();
        ensureBlockSpacing();
        const depth = listStack.length;
        listStack.push({ ordered: name === "ol", depth });
        blockStack.push(name);
        continue;
      }
      if (name === "li") {
        flushDeferredLink();
        closeInlineMarkers();
        if (listStack.length > 0) {
          output += emitListMarker(listStack[listStack.length - 1]);
        } else {
          output += "- ";
        }
        blockStack.push("li");
        continue;
      }

      // ── <nav> — convert non-list nav links to list items ─────────
      if (name === "nav") {
        closeInlineMarkers();
        ensureBlockSpacing();
        inNav = true;
        blockStack.push("nav");
        continue;
      }

      // ── <picture> / <source> — responsive images ─────────────────
      if (name === "picture") {
        closeInlineMarkers();
        inPicture = true;
        pictureSrc = "";
        pictureAlt = "";
        continue;
      }
      if (name === "source" && inPicture && !pictureSrc) {
        const src = getAttrDecoded(tag, "srcset") || getAttrDecoded(tag, "src") || "";
        if (src) pictureSrc = src.split(/\s+/)[0]; // take first source
        continue;
      }
      if (name === "img" && inPicture) {
        if (!pictureSrc) {
          pictureSrc = getAttrDecoded(tag, "src") ?? "";
        }
        if (!pictureAlt) {
          pictureAlt = getAttrDecoded(tag, "alt") ?? "";
        }
        continue;
      }

      // ── <figure> / <figcaption> ──────────────────────────────────
      if (name === "figure") {
        closeInlineMarkers();
        inFigure = true;
        figcaptionText = "";
        continue;
      }
      if (name === "figcaption") {
        inSummary = true; // reuse inSummary for figcaption text collection
        continue;
      }

      // ── <details> / <summary> ────────────────────────────────────
      if (name === "details") {
        closeInlineMarkers();
        inDetails = true;
        summaryText = "";
        continue;
      }
      if (name === "summary") {
        inSummary = true;
        continue;
      }

      // ── <time> — emit content, add datetime if present ───────────
      if (name === "time") {
        const datetime = getAttrDecoded(tag, "datetime");
        if (datetime) {
          inlineStack.push(` (${datetime})`);
        }
        continue;
      }

      // ── Generic blocks ───────────────────────────────────────────
      if (BLOCK_ELEMENTS.has(name)) {
        closeInlineMarkers();
        ensureBlockSpacing();
        blockStack.push(name);
        continue;
      }

      // ── Inline: bold / strong ────────────────────────────────────
      if (name === "b" || name === "strong") {
        if (linkDeferred) flushDeferredLink();
        inlineStack.push("**");
        output += "**";
        continue;
      }

      // ── Inline: italic / em ──────────────────────────────────────
      if (name === "i" || name === "em") {
        if (linkDeferred) flushDeferredLink();
        inlineStack.push("*");
        output += "*";
        continue;
      }

      // ── Inline: strikethrough ────────────────────────────────────
      if (name === "s" || name === "strike" || name === "del") {
        if (linkDeferred) flushDeferredLink();
        inlineStack.push("~~");
        output += "~~";
        continue;
      }

      // ── Inline: code ─────────────────────────────────────────────
      if (name === "code") {
        if (linkDeferred) flushDeferredLink();
        inlineStack.push("`");
        output += "`";
        continue;
      }

      // ── Inline: link (with URL resolution) ───────────────────────
      if (name === "a") {
        const href = getAttrDecoded(tag, "href");
        if (href) {
          // Resolve relative URLs
          const resolved = resolveUrl(href, null);
          // Defer link if at block level — handles <a><h2>Title</h2></a> and
          // <a><div>...</div></a> patterns common in news sites and Reddit
          const trimmedOutput = output.trimEnd();
          const atBlockLevel = trimmedOutput.length === 0 || trimmedOutput.endsWith("\n");
          if (atBlockLevel && !inlineStack.length) {
            linkDeferred = true;
            linkHref = resolved;
            linkContent = "";
            linkOutputStart = output.length;
          } else {
            inlineStack.push(`](${resolved})`);
            output += "[";
          }
        }
        continue;
      }

      // ── Inline: image ────────────────────────────────────────────
      if (name === "img") {
        if (linkDeferred) flushDeferredLink();
        closeInlineMarkers();
        const src = getAttrDecoded(tag, "src") ?? "";
        const alt = (getAttrDecoded(tag, "alt") ?? "").replace(/\]/g, "\\]").replace(/\[/g, "\\[");
        output += `![${alt}](${src})`;
        continue;
      }

      // ── Inline: sub/sup ──────────────────────────────────────────
      if (name === "sub") {
        inlineStack.push("~");
        output += "~";
        continue;
      }
      if (name === "sup") {
        inlineStack.push("^");
        output += "^";
        continue;
      }

      // ── Inline: abbreviation ─────────────────────────────────────
      if (name === "abbr") {
        const title = getAttrDecoded(tag, "title");
        inlineStack.push(title ? ` (${title})` : "");
        continue;
      }

      // ── Inline: mark/highlight ───────────────────────────────────
      if (name === "mark") {
        inlineStack.push("==");
        output += "==";
        continue;
      }

      // ── Inline: quote ────────────────────────────────────────────
      if (name === "q") {
        inlineStack.push('"');
        output += '"';
        continue;
      }

      // ── Other opening tags — just skip ───────────────────────────
      continue;
    }

    // ── Closing tags ───────────────────────────────────────────────
    const name = tag.name;

    // ── Headings ───────────────────────────────────────────────────
    if (/^h[1-6]$/.test(name)) {
      closeInlineMarkers();
      if (linkDeferred) {
        linkContent += "\n";
      } else {
        output += "\n\n";
      }
      blockStack.pop();
      continue;
    }

    // ── Paragraph ──────────────────────────────────────────────────
    if (name === "p") {
      closeInlineMarkers();
      if (linkDeferred) {
        linkContent += "\n\n";
      } else {
        const insideLi = blockStack.includes("li");
        if (!insideLi) {
          output += "\n\n";
        }
      }
      blockStack.pop();
      continue;
    }

    // ── Pre ────────────────────────────────────────────────────────
    if (name === "pre") {
      flushPre();
      blockStack.pop();
      continue;
    }

    // ── Blockquote ─────────────────────────────────────────────────
    if (name === "blockquote") {
      closeInlineMarkers();
      output += "\n\n";
      blockStack.pop();
      continue;
    }

    // ── Tables ─────────────────────────────────────────────────────
    if (name === "table") {
      if (inTr && currentTableCells.length > 0) {
        tableRows.push("| " + currentTableCells.join(" | ") + " |");
        if (!tableHeaderDone) {
          tableRows.push("|" + currentTableCells.map(() => " --- ").join("|") + "|");
          tableHeaderDone = true;
        }
        currentTableCells.length = 0;
        inTr = false;
      }
      flushTable();
      blockStack.pop();
      continue;
    }
    if (name === "caption") {
      // Caption text was collected inline; nothing to do on close
      continue;
    }
    if (name === "tr") {
      if (currentTableCells.length > 0) {
        tableRows.push("| " + currentTableCells.join(" | ") + " |");
        if (!tableHeaderDone) {
          tableRows.push("|" + currentTableCells.map(() => " --- ").join("|") + "|");
          tableHeaderDone = true;
        }
        currentTableCells.length = 0;
      }
      inTr = false;
      continue;
    }
    if (name === "td" || name === "th") {
      continue;
    }

    // ── Lists ──────────────────────────────────────────────────────
    if (name === "ul" || name === "ol") {
      closeInlineMarkers();
      while (listStack.length > 0 && listStack[listStack.length - 1].ordered !== (name === "ol")) {
        listStack.pop();
      }
      if (listStack.length > 0) listStack.pop();
      output += "\n\n";
      blockStack.pop();
      continue;
    }
    if (name === "li") {
      closeInlineMarkers();
      // Trim trailing whitespace from list item content before newline
      output = output.replace(/[\s]+$/, "");
      output += "\n";
      blockStack.pop();
      continue;
    }

    // ── <nav> ──────────────────────────────────────────────────────
    if (name === "nav") {
      closeInlineMarkers();
      ensureBlockSpacing();
      inNav = false;
      blockStack.pop();
      continue;
    }

    // ── <picture> ──────────────────────────────────────────────────
    if (name === "picture") {
      flushPicture();
      continue;
    }

    // ── <figure> / <figcaption> ────────────────────────────────────
    if (name === "figure") {
      flushFigure();
      continue;
    }
    if (name === "figcaption") {
      inSummary = false;
      continue;
    }

    // ── <details> / <summary> ──────────────────────────────────────
    if (name === "details") {
      closeInlineMarkers();
      output += "\n\n";
      inDetails = false;
      inSummary = false;
      summaryText = "";
      continue;
    }
    if (name === "summary") {
      inSummary = false;
      continue;
    }

    // ── <time> ─────────────────────────────────────────────────────
    if (name === "time") {
      if (inlineStack.length > 0 && inlineStack[inlineStack.length - 1].startsWith(" (")) {
        output += inlineStack.pop();
      }
      continue;
    }

    // ── Generic blocks ─────────────────────────────────────────────
    if (BLOCK_ELEMENTS.has(name)) {
      closeInlineMarkers();
      ensureBlockSpacing();
      blockStack.pop();
      continue;
    }

    // ── Inline closings ────────────────────────────────────────────
    if (name === "b" || name === "strong") {
      if (inlineStack.length > 0 && inlineStack[inlineStack.length - 1] === "**") {
        inlineStack.pop();
        output += "**";
      }
      continue;
    }
    if (name === "i" || name === "em") {
      if (inlineStack.length > 0 && inlineStack[inlineStack.length - 1] === "*") {
        inlineStack.pop();
        output += "*";
      }
      continue;
    }
    if (name === "s" || name === "strike" || name === "del") {
      if (inlineStack.length > 0 && inlineStack[inlineStack.length - 1] === "~~") {
        inlineStack.pop();
        output += "~~";
      }
      continue;
    }
    if (name === "code") {
      if (inlineStack.length > 0 && inlineStack[inlineStack.length - 1] === "`") {
        inlineStack.pop();
        output += "`";
      }
      continue;
    }
    if (name === "a") {
      if (linkDeferred) {
        // Flush deferred link if we accumulated content
        if (linkContent.trim()) {
          flushDeferredLink();
        } else {
          // No content accumulated — just reset
          linkDeferred = false;
          linkHref = "";
          linkContent = "";
        }
      } else if (inlineStack.length > 0 && inlineStack[inlineStack.length - 1].startsWith("](")) {
        output += inlineStack.pop();
      }
      continue;
    }
    if (name === "sub") {
      if (inlineStack.length > 0 && inlineStack[inlineStack.length - 1] === "~") {
        inlineStack.pop();
        output += "~";
      }
      continue;
    }
    if (name === "sup") {
      if (inlineStack.length > 0 && inlineStack[inlineStack.length - 1] === "^") {
        inlineStack.pop();
        output += "^";
      }
      continue;
    }
    if (name === "abbr") {
      if (inlineStack.length > 0) {
        output += inlineStack.pop();
      }
      continue;
    }
    if (name === "mark") {
      if (inlineStack.length > 0 && inlineStack[inlineStack.length - 1] === "==") {
        inlineStack.pop();
        output += "==";
      }
      continue;
    }
    if (name === "q") {
      if (inlineStack.length > 0 && inlineStack[inlineStack.length - 1] === '"') {
        inlineStack.pop();
        output += '"';
      }
      continue;
    }

    // ── Other closing tags — just skip ─────────────────────────────
    continue;
  }

  // ── Flush remaining state ────────────────────────────────────────
  flushDeferredLink();
  flushPre();
  closeInlineMarkers();
  closeAllLists();
  flushTable();
  flushPicture();
  flushFigure();
  flushDetails();

  // Normalize whitespace: collapse runs of whitespace on each line,
  // trim lines, remove excessive blank lines, strip leading/trailing blanks.
  // Preserve whitespace inside code blocks (between ``` markers).
  const lines = output.split("\n");
  const normalized: string[] = [];
  let prevBlank = false;
  let inCodeBlock = false;
  for (const line of lines) {
    const isFence = line.trimStart().startsWith("```");
    if (isFence) {
      inCodeBlock = !inCodeBlock;
      normalized.push(line.trim());
      prevBlank = false;
      continue;
    }
    const processed = inCodeBlock ? line : collapseWhitespace(line).trim();
    if (processed === "") {
      if (!prevBlank && normalized.length > 0) normalized.push("");
      prevBlank = true;
    } else {
      normalized.push(processed);
      prevBlank = false;
    }
  }
  while (normalized.length > 0 && normalized[0] === "") normalized.shift();
  while (normalized.length > 0 && normalized[normalized.length - 1] === "") normalized.pop();
  return normalized.join("\n");
}
