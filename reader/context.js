// Collects the context sent with a question: the passage around the selection,
// the section heading it sits under, the paper's opening, and where the symbols
// or terms in the selection first appear. Pure functions over page texts
// (index 0 = page 1), shared by the reader page and the tests.

const HEADING_RE = /^\s*((?:\d+(?:\.\d+){0,3}\.?|[IVX]{1,5}\.|[A-Z]\.)\s+[A-Z一-鿿][^\n]{1,90}|(?:Abstract|Introduction|Related Work|Background|Method(?:s|ology)?|Experiments?|Results|Discussion|Conclusions?|References|Appendix)\s*)$/;

/** Find where the selection sits in the page text (whitespace-insensitive). */
export function locate(pageText, selection) {
  const sel = String(selection).replace(/\s+/g, ' ').trim();
  if (!sel) return -1;
  const flat = pageText.replace(/\s+/g, ' ');
  let i = flat.indexOf(sel);
  if (i < 0) i = flat.indexOf(sel.slice(0, Math.min(40, sel.length)));
  if (i < 0) return -1;
  // map index in flat text back to pageText
  let fi = 0;
  for (let pi = 0; pi < pageText.length; pi++) {
    if (fi >= i) return pi;
    const isWs = /\s/.test(pageText[pi]);
    if (isWs) {
      while (pi + 1 < pageText.length && /\s/.test(pageText[pi + 1])) pi++;
    }
    fi++;
  }
  return pageText.length;
}

/** Split text into sentences with their offsets. */
function sentences(text) {
  const out = [];
  let start = 0;
  for (const m of text.matchAll(/[.!?。！？]+(?=\s)/g)) {
    const end = m.index + m[0].length;
    if (text.slice(start, end).trim()) out.push({ start, end });
    start = end;
  }
  if (text.slice(start).trim()) out.push({ start, end: text.length });
  return out;
}

/** Offsets of lines that look like section headings. */
function headingLines(text) {
  const out = [];
  let pos = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.length >= 4 && t.length <= 100 && HEADING_RE.test(t)) out.push({ start: pos, end: pos + line.length });
    pos += line.length + 1;
  }
  return out;
}

/**
 * The sentences containing the selection plus one on each side, capped at
 * maxChars and kept inside the selection's section (never across a heading).
 */
export function passageAround(pageText, selection, maxChars = 700) {
  const at = locate(pageText, selection);
  if (at < 0) return pageText.slice(0, maxChars).trim();
  const selEnd = at + String(selection).length;
  const heads = headingLines(pageText);
  const lo = Math.max(0, ...heads.filter((h) => h.end <= at).map((h) => h.end));
  const hi = Math.min(pageText.length, ...heads.filter((h) => h.start >= selEnd).map((h) => h.start));
  const ss = sentences(pageText.slice(lo, hi)).map((x) => ({ start: x.start + lo, end: x.end + lo }));
  if (!ss.length) return pageText.slice(at, selEnd).replace(/\s+/g, ' ').trim();
  let i = ss.findIndex((x) => x.end > at);
  let j = ss.findIndex((x) => x.end >= selEnd);
  if (i < 0) i = ss.length - 1;
  if (j < 0) j = ss.length - 1;
  let start = ss[i].start;
  let end = ss[j].end;
  if (i > 0 && end - ss[i - 1].start <= maxChars) start = ss[i - 1].start;
  if (j + 1 < ss.length && ss[j + 1].end - start <= maxChars) end = ss[j + 1].end;
  return pageText.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * The whole sentence containing index `at`, plus the next one when short,
 * so a definition is not cut off mid-sentence. Capped at maxChars.
 */
function snippetAt(text, at, maxChars = 420) {
  const heads = headingLines(text);
  const lo = Math.max(0, ...heads.filter((h) => h.end <= at).map((h) => h.end));
  const hi = Math.min(text.length, ...heads.filter((h) => h.start > at).map((h) => h.start));
  const ss = sentences(text.slice(lo, hi)).map((x) => ({ start: x.start + lo, end: x.end + lo }));
  const k = ss.findIndex((x) => x.end > at);
  if (k < 0) return text.slice(at, at + maxChars).replace(/\s+/g, ' ').trim();
  let start = ss[k].start;
  let end = ss[k].end;
  if (k + 1 < ss.length && ss[k + 1].end - start <= maxChars) end = ss[k + 1].end;
  if (end - start > maxChars) {
    // A very long "sentence" (e.g. author list running into the abstract): centre on the match.
    start = Math.max(start, at - Math.floor(maxChars / 3));
    end = Math.min(end, start + maxChars);
    const sp = text.slice(start, at).search(/\s/);
    if (start > 0 && sp >= 0) start += sp + 1;
  }
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/** Nearest heading line before the selection, looking back up to 3 pages. */
export function headingBefore(pageTexts, page, selection) {
  for (let p = page; p >= 1 && p >= page - 3; p--) {
    let text = pageTexts[p - 1] || '';
    if (p === page) {
      const at = locate(text, selection);
      if (at >= 0) text = text.slice(0, at);
    }
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.length >= 4 && line.length <= 100 && HEADING_RE.test(line)) return line;
    }
  }
  return '';
}

const GREEK = /[Ͱ-Ͽ]/u;
const STOP = new Set(['THE', 'AND', 'FOR', 'WITH', 'FIG', 'TABLE', 'EQ', 'SEC', 'ET', 'AL', 'IN', 'OF', 'TO', 'A', 'I']);

/** Symbols and acronyms in the selection worth looking up elsewhere in the paper. */
export function termsIn(selection) {
  const s = String(selection);
  const terms = new Set();
  for (const m of s.matchAll(/[Ͱ-Ͽ][₀-ₜ⁰-ⁿ₀-₉]*/gu)) terms.add(m[0]);
  for (const m of s.matchAll(/\b[A-Z][A-Za-z]*[A-Z][A-Za-z0-9-]*\b|\b[A-Z]{2,}s?\b/g)) {
    if (!STOP.has(m[0].toUpperCase())) terms.add(m[0]);
  }
  return [...terms].slice(0, 6);
}

/**
 * First place each term appears outside the selected passage itself.
 * @returns {Array<{term:string,page:number,snippet:string}>}
 */
export function definitionsFor(pageTexts, page, selection, max = 3) {
  const out = [];
  const hits = [];
  const add = (term, p, idx, text) => {
    // A nearby earlier hit already covers this spot (e.g. τ and τ₀ in one sentence).
    const near = hits.find((h) => h.p === p && Math.abs(h.idx - idx) < 150);
    if (near) {
      near.entry.term += `、${term}`;
      return;
    }
    const entry = { term, page: p, snippet: snippetAt(text, idx) };
    hits.push({ p, idx, entry });
    out.push(entry);
  };
  const selAt = locate(pageTexts[page - 1] || '', selection);
  for (const term of termsIn(selection)) {
    const isSymbol = GREEK.test(term) && term.length <= 3;
    const re = isSymbol
      ? new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u')
      : new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    for (let p = 1; p <= pageTexts.length; p++) {
      const text = pageTexts[p - 1] || '';
      const m = re.exec(text);
      if (!m) continue;
      // Skip the occurrence inside the selection itself.
      if (p === page && selAt >= 0 && m.index >= selAt - 5 && m.index <= selAt + String(selection).length) {
        const rest = re.exec(text.slice(selAt + String(selection).length));
        if (!rest) continue;
        const idx = selAt + String(selection).length + rest.index;
        add(term, p, idx, text);
        break;
      }
      if (p > page) break; // only earlier mentions count as a definition
      add(term, p, m.index, text);
      break;
    }
    if (out.length >= max) break;
  }
  return out;
}

export function buildContext(pageTexts, page, selection) {
  return {
    overview: (pageTexts[0] || '').slice(0, 1200),
    heading: headingBefore(pageTexts, page, selection),
    passage: passageAround(pageTexts[page - 1] || '', selection),
    definitions: definitionsFor(pageTexts, page, selection),
  };
}
