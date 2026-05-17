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

// ── Utility ──────────────────────────────────────────────────────────

/** Get an attribute value from a tag token by name (case-insensitive). */
export function getAttr(token: Extract<Token, { kind: "tag" }>, name: string): string | null {
  const attr = token.attributes.find(a => a.name.toLowerCase() === name);
  return attr?.value ?? null;
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
  let skipDepth = 0;    // depth inside <script>/<style> blocks
  let prevWasTag = false; // was the last processed token a (non-script/style) tag?

  for (const token of tokenize(html)) {
    // Track entry into <script> / <style> blocks
    if (token.kind === "tag" && !token.isClosing && (token.name === "script" || token.name === "style")) {
      skipDepth++;
      continue;
    }
    // Track exit from </script> / </style> blocks
    if (token.kind === "tag" && token.isClosing && (token.name === "script" || token.name === "style")) {
      if (skipDepth > 0) skipDepth--;
      continue;
    }
    // Skip all content inside script/style blocks
    if (skipDepth > 0) continue;

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
 * - Links, images
 * - Lists (ordered/unordered, nested)
 * - Code (inline and blocks)
 * - Blockquotes, horizontal rules
 * - Tables (basic)
 * - Paragraphs, line breaks
 * - Sub/superscript, abbreviation, mark/highlight
 * - Skips script/style/head/meta/title
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
  let skipContent = false;                  // inside skip element
  let skipDepth = 0;
  let output = "";
  let noBlockSpacing = false;               // suppress next ensureBlockSpacing

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

  function flushBlock() {
    flushPre();
    closeInlineMarkers();
    closeAllLists();
    flushTable();
  }

  // ── Process tokens ───────────────────────────────────────────────

  for (const token of tokenize(html)) {
    // ── Skip elements ──────────────────────────────────────────────
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

    // Comments and doctypes are dropped
    if (token.kind === "comment" || token.kind === "doctype") continue;

    // ── Text ───────────────────────────────────────────────────────
    if (token.kind === "text") {
      const text = decodeTextEntities(token.data);
      if (inPre) {
        preContent += text;
      } else if (inTable && inTr) {
        currentTableCells.push(text.trim());
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
        flushBlock();
        ensureBlockSpacing();
        const level = parseInt(name[1], 10);
        output += "#".repeat(level) + " ";
        blockStack.push(name);
        continue;
      }

      // ── Paragraph ────────────────────────────────────────────────
      if (name === "p") {
        flushPre();
        closeInlineMarkers();
        flushTable();
        ensureBlockSpacing();
        blockStack.push("p");
        continue;
      }

      // ── Line break ───────────────────────────────────────────────
      if (name === "br") {
        closeInlineMarkers();
        output += "\n\n";
        continue;
      }

      // ── Horizontal rule ──────────────────────────────────────────
      if (name === "hr") {
        flushBlock();
        ensureBlockSpacing();
        output += "---\n\n";
        continue;
      }

      // ── Pre / code blocks ────────────────────────────────────────
      if (name === "pre") {
        closeInlineMarkers();
        closeAllLists();
        flushTable();
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
        ensureBlockSpacing();
        inTable = true;
        blockStack.push("table");
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
        flushPre();
        closeInlineMarkers();
        flushTable();
        ensureBlockSpacing();
        const depth = listStack.length;
        listStack.push({ ordered: name === "ol", depth });
        blockStack.push(name);
        continue;
      }
      if (name === "li") {
        closeInlineMarkers();
        if (listStack.length > 0) {
          output += emitListMarker(listStack[listStack.length - 1]);
        } else {
          output += "- ";
        }
        blockStack.push("li");
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
        inlineStack.push("**");
        output += "**";
        continue;
      }

      // ── Inline: italic / em ──────────────────────────────────────
      if (name === "i" || name === "em") {
        inlineStack.push("*");
        output += "*";
        continue;
      }

      // ── Inline: strikethrough ────────────────────────────────────
      if (name === "s" || name === "strike" || name === "del") {
        inlineStack.push("~~");
        output += "~~";
        continue;
      }

      // ── Inline: code ─────────────────────────────────────────────
      if (name === "code") {
        inlineStack.push("`");
        output += "`";
        continue;
      }

      // ── Inline: link ─────────────────────────────────────────────
      if (name === "a") {
        const href = getAttr(tag, "href");
        if (href) {
          inlineStack.push(`](${href})`);
          output += "[";
        }
        continue;
      }

      // ── Inline: image ────────────────────────────────────────────
      if (name === "img") {
        closeInlineMarkers();
        const src = getAttr(tag, "src") ?? "";
        const alt = (getAttr(tag, "alt") ?? "").replace(/\]/g, "\\]").replace(/\[/g, "\\[");
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
        const title = getAttr(tag, "title");
        // Output text content, add title as parenthetical if present
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
      output += "\n\n";
      blockStack.pop();
      continue;
    }

    // ── Paragraph ──────────────────────────────────────────────────
    if (name === "p") {
      closeInlineMarkers();
      output += "\n\n";
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
      // Pop list entries until we find matching type
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
      output += "\n";
      blockStack.pop();
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
      if (inlineStack.length > 0 && inlineStack[inlineStack.length - 1].startsWith("](")) {
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
  flushPre();
  closeInlineMarkers();
  closeAllLists();
  flushTable();

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
