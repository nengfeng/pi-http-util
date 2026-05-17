/**
 * entities.ts — HTML entity decoding.
 *
 * Pure functions for decoding named and numeric HTML entities.
 * Entity map is a module-level constant (not recreated per call).
 */

// ── Entity Map (module-level constant) ───────────────────────────────

const ENTITIES: Readonly<Record<string, string>> = {
  // ── Core ──────────────────────────────────────────────────────
  nbsp: "\u00A0", lt: "<", gt: ">", amp: "&", quot: '"', apos: "'",
  // ── Currency & misc symbols ───────────────────────────────────
  copy: "\u00A9", reg: "\u00AE", trade: "\u2122",
  deg: "\u00B0", plusmn: "\u00B1", times: "\u00D7", divide: "\u00F7",
  frac12: "\u00BD", frac14: "\u00BC", frac34: "\u00BE",
  euro: "\u20AC", pound: "\u00A3", yen: "\u00A5", cent: "\u00A2",
  // ── Quotes & dashes ───────────────────────────────────────────
  mdash: "\u2014", ndash: "\u2013", laquo: "\u00AB", raquo: "\u00BB",
  bull: "\u2022", hellip: "\u2026", prime: "\u2032", Prime: "\u2033",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D",
  sbquo: "\u201A",
  // ── Whitespace ────────────────────────────────────────────────
  ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009", zwsp: "\u200B",
  tab: "\t", newline: "\n",
  // ── Latin-1 Supplement (U+0080–U+00FF) ────────────────────────
  Agrave: "\u00C0", Aacute: "\u00C1", Acirc: "\u00C2", Atilde: "\u00C3",
  Auml: "\u00C4", Aring: "\u00C5", AElig: "\u00C6", Ccedil: "\u00C7",
  Egrave: "\u00C8", Eacute: "\u00C9", Ecirc: "\u00CA", Euml: "\u00CB",
  Igrave: "\u00CC", Iacute: "\u00CD", Icirc: "\u00CE", Iuml: "\u00CF",
  ETH: "\u00D0", Ntilde: "\u00D1", Ograve: "\u00D2", Oacute: "\u00D3",
  Ocirc: "\u00D4", Otilde: "\u00D5", Ouml: "\u00D6",
  Oslash: "\u00D8", Ugrave: "\u00D9", Uacute: "\u00DA", Ucirc: "\u00DB",
  Uuml: "\u00DC", Yacute: "\u00DD",
  THORN: "\u00DE", Oelig: "\u0152",
  agrave: "\u00E0", aacute: "\u00E1", acirc: "\u00E2", atilde: "\u00E3",
  auml: "\u00E4", aring: "\u00E5", aelig: "\u00E6", ccedil: "\u00E7",
  egrave: "\u00E8", eacute: "\u00E9", ecirc: "\u00EA", euml: "\u00EB",
  igrave: "\u00EC", iacute: "\u00ED", icirc: "\u00EE", iuml: "\u00EF",
  eth: "\u00F0", ntilde: "\u00F1", ograve: "\u00F2", oacute: "\u00F3",
  ocirc: "\u00F4", otilde: "\u00F5", ouml: "\u00F6",
  oslash: "\u00F8", ugrave: "\u00F9", uacute: "\u00FA", ucirc: "\u00FB",
  uuml: "\u00FC", yacute: "\u00FD",
  thorn: "\u00FE", yuml: "\u00FF",
  oelig: "\u0153", szlig: "\u00DF",
  // ── Latin Extended (common accented chars) ────────────────────
  Amacr: "\u0100", aamacr: "\u0101",
  Abreve: "\u0102", abreve: "\u0103",
  Aogonek: "\u0104", aogonek: "\u0105",
  Cacute: "\u0106", cacute: "\u0107",
  Ccirc: "\u0108", ccirc: "\u0109",
  Cdot: "\u010A", cdot: "\u010B",
  Ccaron: "\u010C", ccaron: "\u010D",
  Dcaron: "\u010E", dcaron: "\u010F",
  Dstroke: "\u0110", dstroke: "\u0111",
  Emacr: "\u0112", emacr: "\u0113",
  Ebreve: "\u0114", ebreve: "\u0115",
  Edot: "\u0116", edot: "\u0117",
  Eogonek: "\u0118", eogonek: "\u0119",
  Ecaron: "\u011A", ecaron: "\u011B",
  Gcirc: "\u011C", gcirc: "\u011D",
  Gbreve: "\u011E", gbreve: "\u011F",
  Gdot: "\u0120", gdot: "\u0121",
  Gcedil: "\u0122", gcedil: "\u0123",
  Hcirc: "\u0124", hcirc: "\u0125",
  Hstroke: "\u0126", hstroke: "\u0127",
  Imacr: "\u012A", imacr: "\u012B",
  Ibreve: "\u012C", ibreve: "\u012D",
  Iogonek: "\u012E", iogonek: "\u012F",
  Idot: "\u0130",
  IJlig: "\u0132", ijlig: "\u0133",
  Jcirc: "\u0134", jcirc: "\u0135",
  Kcedil: "\u0136", kcedil: "\u0137",
  Lacute: "\u0139", lacute: "\u013A",
  Lcomma: "\u013B", lcomma: "\u013C",
  Lcaron: "\u013D", lcaron: "\u013E",
  Lmidot: "\u013F", lmidot: "\u0140",
  Nacute: "\u0143", nacute: "\u0144",
  Ncomma: "\u0145", ncomma: "\u0146",
  Ncaron: "\u0147", ncaron: "\u0148",
  Eng: "\u014A", eng: "\u014B",
  Omacr: "\u014C", omacr: "\u014D",
  Obreve: "\u014E", obreve: "\u014F",
  Ogonek: "\u0150", ogonek: "\u0151",
  Racute: "\u0154", racute: "\u0155",
  Rcomma: "\u0156", rcomma: "\u0157",
  Rcaron: "\u0158", rcaron: "\u0159",
  Sacute: "\u015A", sacute: "\u015B",
  Scomma: "\u015C", scomma: "\u015D",
  Scaron: "\u0160", scaron: "\u0161",
  Tcedil: "\u0162", tcedil: "\u0163",
  Tcaron: "\u0164", tcaron: "\u0165",
  Tcomma: "\u0166", tcomma: "\u0167",
  Utilde: "\u0168", utilde: "\u0169",
  Umacr: "\u016A", umacr: "\u016B",
  Ubreve: "\u016C", ubreve: "\u016D",
  Uring: "\u016E", uring: "\u016F",
  Uogonek: "\u0170", uogonek: "\u0171",
  Udblac: "\u0172", udblac: "\u0173",
  Ycirc: "\u0174", ycirc: "\u0175",
  Yuml: "\u0178",
  Zacute: "\u0179", zacute: "\u017A",
  Zdot: "\u017B", zdot: "\u017C",
  Zcaron: "\u017D", zcaron: "\u017E",
  // ── Arrows & math ─────────────────────────────────────────────
  nlarr: "\u219E", nrarr: "\u219F", nharr: "\u21AE",
  nlArr: "\u21CD", nrArr: "\u21CF", nhArr: "\u21CE",
  nwarr: "\u2196", nearr: "\u2197", searr: "\u2198", swarr: "\u2199",
  nwarrrw: "\u21BF", nearrw: "\u21C0", searrow: "\u21C1", swarrow: "\u21C2",
  // ── Miscellaneous ─────────────────────────────────────────────
  not: "\u00AC", shy: "\u00AD",
  // ── Greek (uppercase) ─────────────────────────────────────────
  Alpha: "\u0391", Beta: "\u0392", Gamma: "\u0393", Delta: "\u0394",
  Epsilon: "\u0395", Zeta: "\u0396", Eta: "\u0397", Theta: "\u0398",
  Iota: "\u0399", Kappa: "\u039A", Lambda: "\u039B", Mu: "\u039C",
  Nu: "\u039D", Xi: "\u039E", Omicron: "\u039F",
  Pi: "\u03A0", Rho: "\u03A1", Sigma: "\u03A3", Tau: "\u03A4",
  Upsilon: "\u03A5", Phi: "\u03A6", Chi: "\u03A7", Psi: "\u03A8", Omega: "\u03A9",
  // ── Greek (lowercase) ─────────────────────────────────────────
  alpha: "\u03B1", beta: "\u03B2", gamma: "\u03B3", delta: "\u03B4",
  epsilon: "\u03B5", zeta: "\u03B6", eta: "\u03B7", theta: "\u03B8",
  iota: "\u03B9", kappa: "\u03BA", lambda: "\u03BB", mu: "\u03BC",
  nu: "\u03BD", xi: "\u03BE", omicron: "\u03BF",
  pi: "\u03C0", rho: "\u03C1", sigmaf: "\u03C2", sigma: "\u03C3",
  tau: "\u03C4", upsilon: "\u03C5", phi: "\u03C6", chi: "\u03C7",
  psi: "\u03C8", omega: "\u03C9",
  thetasym: "\u03D1", upsih: "\u03D2", piv: "\u03D6",
};

// ── Public API ───────────────────────────────────────────────────────

/**
 * Decode a named HTML entity to its character.
 * Returns null if the entity name is not recognized.
 */
export function decodeHtmlEntity(name: string): string | null {
  return ENTITIES[name] ?? null;
}

/**
 * Decode a single HTML entity at the given position.
 * Returns { char, consumed } on success, null if no entity found.
 *
 * Supports:
 * - Named entities: &nbsp;, &lt;, &gt;, etc.
 * - Decimal numeric: &#160;, &#8364;
 * - Hex numeric: &#xA0;, &#x20AC;
 */
export function decodeEntity(text: string, pos: number): { char: string; consumed: number } | null {
  if (text[pos] !== "&") return null;

  // Named entity (up to 10 chars, must end with ;)
  const semiIdx = text.indexOf(";", pos + 1);
  if (semiIdx !== -1) {
    const entity = text.slice(pos + 1, semiIdx);
    if (entity.length <= 10) {
      const decoded = decodeHtmlEntity(entity);
      if (decoded) return { char: decoded, consumed: semiIdx - pos + 1 };
    }
  }

  // Numeric entity: &#123; or &#x1A;
  if (text[pos + 1] === "#") {
    const end = Math.min(pos + 10, text.length); // up to 7 digits + &# + ;
    let numEnd = pos + 2;
    let value: number;
    if (text[pos + 2] === "x" || text[pos + 2] === "X") {
      // Hex
      numEnd = pos + 3;
      while (numEnd < end && "0123456789abcdefABCDEF".includes(text[numEnd])) numEnd++;
      if (numEnd < text.length && text[numEnd] === ";") numEnd++;
      value = parseInt(text.slice(pos + 3, numEnd - 1 || numEnd), 16);
    } else {
      // Decimal
      while (numEnd < end && "0123456789".includes(text[numEnd])) numEnd++;
      if (numEnd < text.length && text[numEnd] === ";") numEnd++;
      value = parseInt(text.slice(pos + 2, numEnd - 1 || numEnd), 10);
    }
    if (!isNaN(value) && value > 0) {
      return { char: String.fromCodePoint(value), consumed: numEnd - pos };
    }
  }

  return null;
}

/**
 * Decode all HTML entities within a text string.
 * Non-entity ampersands are preserved as-is.
 */
export function decodeTextEntities(text: string): string {
  let result = "";
  let i = 0;
  const len = text.length;

  while (i < len) {
    const decoded = decodeEntity(text, i);
    if (decoded) {
      result += decoded.char;
      i += decoded.consumed;
    } else {
      result += text[i];
      i++;
    }
  }

  return result;
}
