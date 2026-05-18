/**
 * md_handler.ts — SAX-style event handler for HTML-to-Markdown conversion.
 *
 * Processes MdEvents with an element stack to track context.
 * Each event is dispatched to the appropriate handler function.
 * Unknown elements are treated as paragraphs (block-level text containers).
 */

import { decodeTextEntities } from "./entities.ts";
import { collapseWhitespace } from "./whitespace.ts";
import type { MdEvent } from "./md_emitter.ts";
import {
  SKIP_ELEMENTS,
  SKIP_VOID_ELEMENTS,
  BLOCK_ELEMENTS,
  INLINE_FORMAT_ELEMENTS,
  VOID_ELEMENTS,
  headingLevel,
  isListContainer,
  isTableRowElement,
} from "./md_emitter.ts";
import type { Attribute } from "./tokenizer.ts";

// ── Attribute Helpers ────────────────────────────────────────────────

function findAttr(attrs: Attribute[], name: string): Attribute | undefined {
  return attrs.find(a => a.name.toLowerCase() === name);
}

function getAttrValue(attrs: Attribute[], name: string): string | null {
  const attr = findAttr(attrs, name);
  return attr ? (attr.value !== null ? decodeTextEntities(attr.value) : null) : null;
}

// ── Element Context on the Stack ─────────────────────────────────────

interface ElementContext {
  name: string;
  isSkip: boolean;
  isBlock: boolean;
  isInline: boolean;
  isVoid: boolean;
  href?: string;          // for <a> elements
  alt?: string;           // for <img> elements
  src?: string;           // for <img> elements
  title?: string;         // for <abbr> elements
  datetime?: string;      // for <time> elements
}

// ── Handler State ────────────────────────────────────────────────────

interface HandlerState {
  stack: ElementContext[];
  output: string;
  inlineMarkers: string[];
  listStack: { ordered: boolean; depth: number }[];
  preContent: string;
  inPre: boolean;
  skipDepth: number;
  tableRows: string[];
  inTable: boolean;
  inTr: boolean;
  currentCells: string[];
  tableHeaderDone: boolean;
  tableCaption: string;
  noBlockSpacing: boolean;
  lastWasHr: boolean;
  inSummary: boolean;
  inDetails: boolean;
  figcaptionText: string;
  inFigure: boolean;
  pictureSrc: string;
  pictureAlt: string;
  inPicture: boolean;
}

// ── State Initialization ─────────────────────────────────────────────

function createHandlerState(): HandlerState {
  return {
    stack: [],
    output: "",
    inlineMarkers: [],
    listStack: [],
    preContent: "",
    inPre: false,
    skipDepth: 0,
    tableRows: [],
    inTable: false,
    inTr: false,
    currentCells: [],
    tableHeaderDone: false,
    tableCaption: "",
    noBlockSpacing: false,
    lastWasHr: false,
    inSummary: false,
    inDetails: false,
    figcaptionText: "",
    inFigure: false,
    pictureSrc: "",
    pictureAlt: "",
    inPicture: false,
  };
}

// ── Stack Helpers ────────────────────────────────────────────────────

function isInside(state: HandlerState, name: string): boolean {
  return state.stack.some(el => el.name === name);
}

function isInsideLink(state: HandlerState): boolean {
  return state.stack.some(el => el.name === "a" && el.href !== undefined);
}

function isAtBlockLevel(state: HandlerState): boolean {
  return state.output.trimEnd().length === 0 || state.output.trimEnd().endsWith("\n");
}

// ── Output Helpers ───────────────────────────────────────────────────

function ensureBlockSpacing(state: HandlerState): void {
  if (state.noBlockSpacing) {
    state.noBlockSpacing = false;
    return;
  }
  const out = state.output;
  if (out.length > 0 && !out.endsWith("\n\n") && !out.endsWith("\n")) {
    state.output += "\n\n";
  }
}

function closeInlineMarkers(state: HandlerState): void {
  while (state.inlineMarkers.length > 0) {
    state.output += state.inlineMarkers.pop()!;
  }
}

function closeAllLists(state: HandlerState): void {
  state.listStack.length = 0;
}

function emitListMarker(list: { ordered: boolean; depth: number }): string {
  const indent = "  ".repeat(list.depth);
  return list.ordered ? `${indent}1. ` : `${indent}- `;
}

// ── Flush Helpers ────────────────────────────────────────────────────

function flushTable(state: HandlerState): void {
  if (state.inTr && state.currentCells.length > 0) {
    state.tableRows.push("| " + state.currentCells.join(" | ") + " |");
    if (!state.tableHeaderDone) {
      state.tableRows.push(
        "|" + state.currentCells.map(() => " --- ").join("|") + "|"
      );
      state.tableHeaderDone = true;
    }
    state.currentCells.length = 0;
    state.inTr = false;
  }
  if (state.tableCaption) {
    ensureBlockSpacing(state);
    state.output += state.tableCaption + "\n\n";
    state.tableCaption = "";
  }
  if (state.tableRows.length > 0) {
    ensureBlockSpacing(state);
    for (const row of state.tableRows) {
      state.output += row + "\n";
    }
    state.tableRows.length = 0;
    state.tableHeaderDone = false;
  }
  state.inTable = false;
  state.inTr = false;
  state.currentCells.length = 0;
}

function flushPre(state: HandlerState): void {
  if (state.preContent) {
    ensureBlockSpacing(state);
    state.output += "```\n" + state.preContent + "```\n\n";
    state.preContent = "";
  }
  state.inPre = false;
}

function flushPicture(state: HandlerState): void {
  if (state.pictureSrc) {
    const alt = state.pictureAlt.replace(/\]/g, "\\]").replace(/\[/g, "\\[");
    closeInlineMarkers(state);
    state.output += `![${alt}](${state.pictureSrc})`;
  }
  state.inPicture = false;
  state.pictureSrc = "";
  state.pictureAlt = "";
}

function flushFigure(state: HandlerState): void {
  flushPicture(state);
  if (state.figcaptionText.trim()) {
    state.output += `\n*${state.figcaptionText.trim()}*`;
  }
  state.inFigure = false;
  state.figcaptionText = "";
}

function flushDetails(state: HandlerState): void {
  state.inDetails = false;
  state.inSummary = false;
}

function flushBlock(state: HandlerState): void {
  flushPre(state);
  closeInlineMarkers(state);
  closeAllLists(state);
  flushTable(state);
  flushPicture(state);
  flushFigure(state);
  flushDetails(state);
}

// ── Skip Element Handling ────────────────────────────────────────────

function handleSkipOpen(state: HandlerState, name: string): void {
  // Void elements (meta, link, base) don't have closing tags — don't track depth
  if (!SKIP_VOID_ELEMENTS.has(name)) {
    state.skipDepth++;
  }
  state.stack.push({
    name,
    isSkip: true,
    isBlock: false,
    isInline: false,
    isVoid: false,
  });
}

function handleSkipClose(state: HandlerState): void {
  if (state.skipDepth > 0) {
    state.skipDepth--;
    // Pop until we find the matching skip element or stack empties
    while (state.stack.length > 0) {
      const top = state.stack.pop()!;
      if (top.isSkip && state.skipDepth <= 0) break;
    }
  }
}

// ── Text Event Handler ───────────────────────────────────────────────

function handleText(state: HandlerState, data: string): void {
  if (state.skipDepth > 0) return;

  let text = decodeTextEntities(data);
  text = text.replace(/\{\{[^}]*\}\}/g, "").replace(/\{#[^#]*#\}/g, "");

  if (state.inPre) {
    state.preContent += text;
  } else if (state.inTable && state.inTr) {
    state.currentCells.push(text.trim());
  } else if (state.inFigure && !state.inPicture) {
    state.figcaptionText += text;
  } else {
    // Text goes to output directly (including inside <summary>)
    state.output += text;
  }
}

// ── Open Tag Handlers ────────────────────────────────────────────────

function handleOpenHeading(state: HandlerState, level: number): void {
  flushBlock(state);
  ensureBlockSpacing(state);
  state.output += "#".repeat(level) + " ";
}

function handleOpenP(state: HandlerState): void {
  flushPre(state);
  closeInlineMarkers(state);
  flushTable(state);
  flushPicture(state);
  flushFigure(state);
  const insideLi = isInside(state, "li");
  if (!insideLi) {
    ensureBlockSpacing(state);
  }
}

function handleOpenBr(state: HandlerState): void {
  closeInlineMarkers(state);
  state.output += "\n\n";
}

function handleOpenHr(state: HandlerState): void {
  if (state.lastWasHr) {
    state.lastWasHr = false;
    return;
  }
  flushBlock(state);
  ensureBlockSpacing(state);
  state.output += "---\n\n";
  state.lastWasHr = true;
}

function handleOpenPre(state: HandlerState): void {
  closeInlineMarkers(state);
  closeAllLists(state);
  flushTable(state);
  flushPicture(state);
  flushFigure(state);
  flushPre(state);
  ensureBlockSpacing(state);
  state.inPre = true;
}

function handleOpenBlockquote(state: HandlerState): void {
  flushPre(state);
  closeInlineMarkers(state);
  flushTable(state);
  flushPicture(state);
  flushFigure(state);
  ensureBlockSpacing(state);
  state.output += "> ";
  state.noBlockSpacing = true;
}

function handleOpenTable(state: HandlerState): void {
  flushPre(state);
  closeInlineMarkers(state);
  flushTable(state);
  flushPicture(state);
  flushFigure(state);
  ensureBlockSpacing(state);
  state.inTable = true;
}

function handleOpenTr(state: HandlerState): void {
  state.inTr = true;
  state.currentCells.length = 0;
}

function handleOpenUl(state: HandlerState): void {
  flushPre(state);
  closeInlineMarkers(state);
  flushTable(state);
  flushPicture(state);
  flushFigure(state);
  ensureBlockSpacing(state);
  state.listStack.push({ ordered: false, depth: state.listStack.length });
}

function handleOpenOl(state: HandlerState): void {
  flushPre(state);
  closeInlineMarkers(state);
  flushTable(state);
  flushPicture(state);
  flushFigure(state);
  ensureBlockSpacing(state);
  state.listStack.push({ ordered: true, depth: state.listStack.length });
}

function handleOpenLi(state: HandlerState): void {
  closeInlineMarkers(state);
  if (state.listStack.length > 0) {
    state.output += emitListMarker(state.listStack[state.listStack.length - 1]);
  } else {
    state.output += "- ";
  }
}

function handleOpenA(state: HandlerState, href: string): void {
  if (isAtBlockLevel(state) && state.inlineMarkers.length === 0) {
    // Defer: at block level, can't inline link yet
    // We'll handle this by just opening inline and closing at </a>
    // For simplicity, treat all links as inline
  }
  state.inlineMarkers.push(`](${href})`);
  state.output += "[";
}

function handleOpenImg(state: HandlerState, src: string, alt: string): void {
  closeInlineMarkers(state);
  const escapedAlt = alt.replace(/\]/g, "\\]").replace(/\[/g, "\\[");
  state.output += `![${escapedAlt}](${src})`;
}

function handleOpenBold(state: HandlerState): void {
  state.inlineMarkers.push("**");
  state.output += "**";
}

function handleOpenItalic(state: HandlerState): void {
  state.inlineMarkers.push("*");
  state.output += "*";
}

function handleOpenStrike(state: HandlerState): void {
  state.inlineMarkers.push("~~");
  state.output += "~~";
}

function handleOpenCode(state: HandlerState): void {
  state.inlineMarkers.push("`");
  state.output += "`";
}

function handleOpenSub(state: HandlerState): void {
  state.inlineMarkers.push("~");
  state.output += "~";
}

function handleOpenSup(state: HandlerState): void {
  state.inlineMarkers.push("^");
  state.output += "^";
}

function handleOpenAbbr(state: HandlerState, title: string | null): void {
  if (title) {
    state.inlineMarkers.push(` (${title})`);
  }
}

function handleOpenMark(state: HandlerState): void {
  state.inlineMarkers.push("==");
  state.output += "==";
}

function handleOpenQ(state: HandlerState): void {
  state.inlineMarkers.push('"');
  state.output += '"';
}

function handleOpenTime(state: HandlerState, datetime: string | null): void {
  if (datetime) {
    state.inlineMarkers.push(` (${datetime})`);
  }
}

function handleOpenPicture(state: HandlerState): void {
  closeInlineMarkers(state);
  state.inPicture = true;
  state.pictureSrc = "";
  state.pictureAlt = "";
}

function handleOpenSource(state: HandlerState, attrs: Attribute[]): void {
  if (state.inPicture && !state.pictureSrc) {
    const src = getAttrValue(attrs, "srcset") || getAttrValue(attrs, "src") || "";
    if (src) state.pictureSrc = src.split(/\s+/)[0];
  }
}

function handleOpenFigure(state: HandlerState): void {
  closeInlineMarkers(state);
  state.inFigure = true;
  state.figcaptionText = "";
}

function handleOpenFigcaption(state: HandlerState): void {
  state.inSummary = true;
}

function handleOpenDetails(state: HandlerState): void {
  closeInlineMarkers(state);
  ensureBlockSpacing(state);
  state.output += "> ";
  state.noBlockSpacing = true;
  state.inDetails = true;
}

function handleOpenSummary(state: HandlerState): void {
  state.output += "**";
  state.inSummary = true;
}

function handleOpenGenericBlock(state: HandlerState): void {
  closeInlineMarkers(state);
  ensureBlockSpacing(state);
}

// ── Close Tag Handlers ───────────────────────────────────────────────

function handleCloseHeading(state: HandlerState): void {
  closeInlineMarkers(state);
  state.output += "\n\n";
}

function handleCloseP(state: HandlerState): void {
  closeInlineMarkers(state);
  const insideLi = isInside(state, "li");
  if (!insideLi) {
    state.output += "\n\n";
  }
}

function handleClosePre(state: HandlerState): void {
  flushPre(state);
}

function handleCloseBlockquote(state: HandlerState): void {
  closeInlineMarkers(state);
  state.output += "\n\n";
}

function handleCloseTable(state: HandlerState): void {
  if (state.inTr && state.currentCells.length > 0) {
    state.tableRows.push("| " + state.currentCells.join(" | ") + " |");
    if (!state.tableHeaderDone) {
      state.tableRows.push(
        "|" + state.currentCells.map(() => " --- ").join("|") + "|"
      );
      state.tableHeaderDone = true;
    }
    state.currentCells.length = 0;
    state.inTr = false;
  }
  flushTable(state);
}

function handleCloseTr(state: HandlerState): void {
  if (state.currentCells.length > 0) {
    state.tableRows.push("| " + state.currentCells.join(" | ") + " |");
    if (!state.tableHeaderDone) {
      state.tableRows.push(
        "|" + state.currentCells.map(() => " --- ").join("|") + "|"
      );
      state.tableHeaderDone = true;
    }
    state.currentCells.length = 0;
  }
  state.inTr = false;
}

function handleCloseUl(state: HandlerState): void {
  closeInlineMarkers(state);
  popMatchingList(state, false);
  state.output += "\n\n";
}

function handleCloseOl(state: HandlerState): void {
  closeInlineMarkers(state);
  popMatchingList(state, true);
  state.output += "\n\n";
}

function popMatchingList(state: HandlerState, ordered: boolean): void {
  while (state.listStack.length > 0 &&
         state.listStack[state.listStack.length - 1].ordered !== ordered) {
    state.listStack.pop();
  }
  if (state.listStack.length > 0) state.listStack.pop();
}

function handleCloseLi(state: HandlerState): void {
  closeInlineMarkers(state);
  state.output = state.output.replace(/[\s]+$/, "");
  state.output += "\n";
}

function handleCloseA(state: HandlerState): void {
  if (state.inlineMarkers.length > 0 &&
      state.inlineMarkers[state.inlineMarkers.length - 1].startsWith("](")) {
    state.output += state.inlineMarkers.pop()!;
  }
}

function handleCloseBold(state: HandlerState): void {
  popAndEmit(state, "**");
}

function handleCloseItalic(state: HandlerState): void {
  popAndEmit(state, "*");
}

function handleCloseStrike(state: HandlerState): void {
  popAndEmit(state, "~~");
}

function handleCloseCode(state: HandlerState): void {
  popAndEmit(state, "`");
}

function handleCloseSub(state: HandlerState): void {
  popAndEmit(state, "~");
}

function handleCloseSup(state: HandlerState): void {
  popAndEmit(state, "^");
}

function handleCloseAbbr(state: HandlerState): void {
  if (state.inlineMarkers.length > 0) {
    state.output += state.inlineMarkers.pop()!;
  }
}

function handleCloseMark(state: HandlerState): void {
  popAndEmit(state, "==");
}

function handleCloseQ(state: HandlerState): void {
  popAndEmit(state, '"');
}

function handleCloseTime(state: HandlerState): void {
  if (state.inlineMarkers.length > 0 &&
      state.inlineMarkers[state.inlineMarkers.length - 1].startsWith(" (")) {
    state.output += state.inlineMarkers.pop()!;
  }
}

function handleClosePicture(state: HandlerState): void {
  flushPicture(state);
}

function handleCloseFigure(state: HandlerState): void {
  flushFigure(state);
}

function handleCloseFigcaption(state: HandlerState): void {
  state.inSummary = false;
}

function handleCloseDetails(state: HandlerState): void {
  closeInlineMarkers(state);
  state.output += "\n\n";
  state.inDetails = false;
  state.inSummary = false;
}

function handleCloseSummary(state: HandlerState): void {
  state.output += "**\n> ";
  state.inSummary = false;
}

function handleCloseGenericBlock(state: HandlerState): void {
  closeInlineMarkers(state);
  state.output += "\n\n";
}

function popAndEmit(state: HandlerState, marker: string): void {
  if (state.inlineMarkers.length > 0 &&
      state.inlineMarkers[state.inlineMarkers.length - 1] === marker) {
    state.inlineMarkers.pop();
    state.output += marker;
  }
}

// ── Element Context Builder ──────────────────────────────────────────

function buildContext(name: string, attrs: Attribute[]): ElementContext {
  const ctx: ElementContext = {
    name,
    isSkip: SKIP_ELEMENTS.has(name),
    isBlock: BLOCK_ELEMENTS.has(name),
    isInline: INLINE_FORMAT_ELEMENTS.has(name),
    isVoid: VOID_ELEMENTS.has(name),
  };
  if (name === "a") ctx.href = getAttrValue(attrs, "href") ?? undefined;
  if (name === "img") {
    ctx.src = getAttrValue(attrs, "src") ?? undefined;
    ctx.alt = getAttrValue(attrs, "alt") ?? undefined;
  }
  if (name === "abbr") ctx.title = getAttrValue(attrs, "title") ?? undefined;
  if (name === "time") ctx.datetime = getAttrValue(attrs, "datetime") ?? undefined;
  return ctx;
}

// ── Open Tag Dispatch ────────────────────────────────────────────────

/** Type for a simple open handler (no attributes needed). */
type SimpleOpenHandler = (state: HandlerState) => void;

/** Type for an open handler that needs attributes. */
type AttrOpenHandler = (state: HandlerState, attrs: Attribute[]) => void;

/** Dispatch table for elements that need no attributes. */
const OPEN_HANDLERS: ReadonlyMap<string, SimpleOpenHandler> = new Map([
  ["p", handleOpenP],
  ["br", handleOpenBr],
  ["hr", handleOpenHr],
  ["pre", handleOpenPre],
  ["blockquote", handleOpenBlockquote],
  ["table", handleOpenTable],
  ["tr", handleOpenTr],
  ["ul", handleOpenUl],
  ["ol", handleOpenOl],
  ["li", handleOpenLi],
  ["b", handleOpenBold],
  ["strong", handleOpenBold],
  ["i", handleOpenItalic],
  ["em", handleOpenItalic],
  ["s", handleOpenStrike],
  ["strike", handleOpenStrike],
  ["del", handleOpenStrike],
  ["sub", handleOpenSub],
  ["sup", handleOpenSup],
  ["mark", handleOpenMark],
  ["q", handleOpenQ],
  ["picture", handleOpenPicture],
  ["figure", handleOpenFigure],
  ["figcaption", handleOpenFigcaption],
  ["details", handleOpenDetails],
  ["summary", handleOpenSummary],
]);

/** Dispatch table for elements that need attributes. */
const OPEN_ATTR_HANDLERS: ReadonlyMap<string, AttrOpenHandler> = new Map([
  ["a", (s, a) => { const h = getAttrValue(a, "href"); if (h) handleOpenA(s, h); }],
  ["img", handleOpenImgWithPicture],
  ["abbr", (s, a) => handleOpenAbbr(s, getAttrValue(a, "title"))],
  ["time", (s, a) => handleOpenTime(s, getAttrValue(a, "datetime"))],
  ["source", handleOpenSource],
]);

/** Elements that are no-ops on open (table internals, etc.). */
const OPEN_NOOP = new Set([
  "caption", "thead", "tbody", "tfoot", "th", "td",
]);

/** Handle <img> with picture context awareness. */
function handleOpenImgWithPicture(state: HandlerState, attrs: Attribute[]): void {
  if (state.inPicture) {
    if (!state.pictureSrc) state.pictureSrc = getAttrValue(attrs, "src") ?? "";
    if (!state.pictureAlt) state.pictureAlt = getAttrValue(attrs, "alt") ?? "";
  } else {
    handleOpenImg(state, getAttrValue(attrs, "src") ?? "", getAttrValue(attrs, "alt") ?? "");
  }
}

function handleOpenTag(state: HandlerState, name: string, attrs: Attribute[]): void {
  // Inside skip elements: track depth, don't process
  if (state.skipDepth > 0) {
    if (!SKIP_VOID_ELEMENTS.has(name)) state.skipDepth++;
    state.stack.push({ name, isSkip: true, isBlock: false, isInline: false, isVoid: false });
    return;
  }

  // Skip elements (script, style, head, etc.)
  if (SKIP_ELEMENTS.has(name)) {
    handleSkipOpen(state, name);
    return;
  }

  // Headings (h1-h6)
  const hLevel = headingLevel(name);
  if (hLevel > 0) {
    handleOpenHeading(state, hLevel);
    pushNonVoid(state, name, attrs);
    return;
  }

  // <code> inside <pre> is a no-op
  if (name === "code" && state.inPre) return;

  // <code> outside <pre> gets inline code handling
  if (name === "code") {
    handleOpenCode(state);
    pushNonVoid(state, name, attrs);
    return;
  }

  // Dispatch via attribute-aware handlers
  const attrHandler = OPEN_ATTR_HANDLERS.get(name);
  if (attrHandler) {
    attrHandler(state, attrs);
    pushNonVoid(state, name, attrs);
    return;
  }

  // Dispatch via simple handlers
  const handler = OPEN_HANDLERS.get(name);
  if (handler) {
    handler(state);
    pushNonVoid(state, name, attrs);
    return;
  }

  // No-op elements (table internals)
  if (OPEN_NOOP.has(name)) return;

  // Unknown elements: treat known blocks as block-level, else pass through
  if (BLOCK_ELEMENTS.has(name)) {
    handleOpenGenericBlock(state);
  }
  pushNonVoid(state, name, attrs);
}

function pushNonVoid(state: HandlerState, name: string, attrs: Attribute[]): void {
  if (!VOID_ELEMENTS.has(name)) {
    state.stack.push(buildContext(name, attrs));
  }
}

// ── Close Tag Dispatch ───────────────────────────────────────────────

/** Type for a simple close handler. */
type SimpleCloseHandler = (state: HandlerState) => void;

/** Close handlers that also pop the stack. */
const CLOSE_POP_HANDLERS: ReadonlyMap<string, SimpleCloseHandler> = new Map([
  ["p", handleCloseP],
  ["pre", handleClosePre],
  ["blockquote", handleCloseBlockquote],
  ["table", handleCloseTable],
  ["ul", handleCloseUl],
  ["ol", handleCloseOl],
  ["li", handleCloseLi],
  ["b", handleCloseBold],
  ["strong", handleCloseBold],
  ["i", handleCloseItalic],
  ["em", handleCloseItalic],
  ["s", handleCloseStrike],
  ["strike", handleCloseStrike],
  ["del", handleCloseStrike],
  ["a", handleCloseA],
  ["sub", handleCloseSub],
  ["sup", handleCloseSup],
  ["abbr", handleCloseAbbr],
  ["mark", handleCloseMark],
  ["q", handleCloseQ],
  ["time", handleCloseTime],
  ["picture", handleClosePicture],
  ["figure", handleCloseFigure],
  ["figcaption", handleCloseFigcaption],
  ["details", handleCloseDetails],
  ["summary", handleCloseSummary],
]);

/** Close handlers that don't pop the stack (table internals, etc.). */
const CLOSE_NOPOP_HANDLERS: ReadonlyMap<string, SimpleCloseHandler> = new Map([
  ["tr", handleCloseTr],
]);

/** Elements that are no-ops on close. */
const CLOSE_NOOP = new Set([
  "caption", "td", "th",
]);

function handleCloseTag(state: HandlerState, name: string): void {
  // Inside skip elements
  if (state.skipDepth > 0) {
    handleSkipClose(state);
    return;
  }

  // Headings (h1-h6)
  const hLevel = headingLevel(name);
  if (hLevel > 0) {
    handleCloseHeading(state);
    popStack(state, name);
    return;
  }

  // <code>: only emit closing marker outside <pre>
  if (name === "code") {
    if (!state.inPre) handleCloseCode(state);
    popStack(state, name);
    return;
  }

  // Close handlers that pop the stack
  const popHandler = CLOSE_POP_HANDLERS.get(name);
  if (popHandler) {
    popHandler(state);
    popStack(state, name);
    return;
  }

  // Close handlers that don't pop
  const noPopHandler = CLOSE_NOPOP_HANDLERS.get(name);
  if (noPopHandler) {
    noPopHandler(state);
    return;
  }

  // No-op elements
  if (CLOSE_NOOP.has(name)) return;

  // Unknown elements: treat known blocks as block-level
  if (BLOCK_ELEMENTS.has(name)) {
    handleCloseGenericBlock(state);
  }
  popStack(state, name);
}

function popStack(state: HandlerState, name: string): void {
  // Pop the matching element, or if stack is wrong, try to recover
  if (state.stack.length > 0 && state.stack[state.stack.length - 1].name === name) {
    state.stack.pop();
  } else {
    // Try to find and remove from stack (mismatched tags)
    const idx = state.stack.length - 1;
    if (idx >= 0) state.stack.pop();
  }
}

// ── Final Output Normalization ───────────────────────────────────────

function normalizeOutput(output: string): string {
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

// ── Public API ───────────────────────────────────────────────────────

/**
 * Process a stream of MdEvents and produce Markdown output.
 * This is the main entry point for the SAX-style HTML-to-Markdown converter.
 */
export function processEvents(events: Iterable<MdEvent>): string {
  const state = createHandlerState();

  for (const event of events) {
    switch (event.type) {
      case "text":
        handleText(state, event.data);
        break;
      case "open":
        handleOpenTag(state, event.name, event.attributes);
        break;
      case "close":
        handleCloseTag(state, event.name);
        break;
    }
  }

  // Flush remaining state
  closeInlineMarkers(state);
  closeAllLists(state);
  flushTable(state);
  flushPicture(state);
  flushFigure(state);
  flushDetails(state);

  return normalizeOutput(state.output);
}
