// PDF viewer with a selectable text layer, highlights, a selection toolbar and
// an ask card. Plain DOM so it can run inside dsh's sidebar (mounted by
// lib/client.js) and in the local dev page alike.

import { buildContext } from './context.js';

const COLORS = [
  { key: 'yellow', name: '黄色高亮', fill: 'rgba(250, 204, 21, 0.42)', bar: '#d97706' },
  { key: 'green', name: '绿色高亮', fill: 'rgba(74, 222, 128, 0.38)', bar: '#16a34a' },
  { key: 'blue', name: '蓝色高亮', fill: 'rgba(96, 165, 250, 0.38)', bar: '#2563eb' },
  { key: 'pink', name: '粉色高亮', fill: 'rgba(244, 114, 182, 0.36)', bar: '#db2777' },
];
const PRESETS = ['这句话是什么意思？', '解释一下里面的符号和术语', '用大白话讲讲', '作者为什么要这样做？'];

const ICON = {
  spark: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/></svg>',
  copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  send: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

const uid = () => Math.random().toString(36).slice(2, 10);

function loadHighlights(key) {
  if (!key) return [];
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function saveHighlights(key, list) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {}
}

/** Merge client rects of one selection into one box per text line, relative to the page (0..1). */
export function rectsToBoxes(rects, pageRect) {
  const boxes = [];
  for (const r of rects) {
    if (r.width < 1 || r.height < 1) continue;
    const box = {
      x: (r.left - pageRect.left) / pageRect.width,
      y: (r.top - pageRect.top) / pageRect.height,
      w: r.width / pageRect.width,
      h: r.height / pageRect.height,
    };
    if (box.x > 1 || box.y > 1 || box.x + box.w < 0 || box.y + box.h < 0) continue;
    const line = boxes.find((b) => Math.abs(b.y - box.y) < box.h * 0.5 && Math.abs(b.h - box.h) < box.h * 0.6);
    if (line) {
      const x2 = Math.max(line.x + line.w, box.x + box.w);
      const y2 = Math.max(line.y + line.h, box.y + box.h);
      line.x = Math.min(line.x, box.x);
      line.y = Math.min(line.y, box.y);
      line.w = x2 - line.x;
      line.h = y2 - line.y;
    } else boxes.push(box);
  }
  return boxes.map((b) => ({ x: +b.x.toFixed(5), y: +b.y.toFixed(5), w: +b.w.toFixed(5), h: +b.h.toFixed(5) }));
}

/**
 * @param {HTMLElement} host
 * @param {{
 *   data: Uint8Array,
 *   pdfjsUrl: string,
 *   workerUrl: string,
 *   fileLabel?: string,
 *   storageKey?: string,
 *   ask: (q: { question: string, selection: string, page: number, context: object }) => Promise<void>,
 *   askTargetLabel?: string,
 * }} opts
 * @returns {{ dispose(): void }}
 */
export function mountViewer(host, opts) {
  const ac = new AbortController();
  const { signal } = ac;
  const root = el('div', { class: 'dpr-root' });
  const pagesEl = el('div', { class: 'dpr-pages' });
  const statusEl = el('div', { class: 'dpr-status', role: 'status' }, '正在打开 PDF…');
  const toast = el('div', { class: 'dpr-toast', role: 'status', 'aria-live': 'polite' });
  root.append(statusEl, pagesEl, toast);
  host.append(root);

  /** @type {any} */ let pdfjs;
  /** @type {any} */ let doc;
  const pages = []; // { n, el, canvas, textLayer, hl, base:{w,h}, rendered, rendering, task }
  const pageTexts = [];
  let textsReady;
  let scale = 1;
  let highlights = loadHighlights(opts.storageKey);
  let color = 'yellow';
  /** current selection or clicked highlight: { page, text, boxes, highlightId? } */
  let current = null;
  let barEl = null;
  let cardEl = null;
  let toastTimer = 0;

  const showToast = (msg) => {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  };

  // ── layout & rendering ──────────────────────────────────────────────
  const fitScale = () => {
    const avail = Math.max(200, root.clientWidth - 24);
    const baseW = pages[0]?.base.w || 612;
    return Math.min(2.5, Math.max(0.4, avail / baseW));
  };

  const sizePage = (p) => {
    p.el.style.width = `${Math.floor(p.base.w * scale)}px`;
    p.el.style.height = `${Math.floor(p.base.h * scale)}px`;
  };

  const unrender = (p) => {
    p.task?.cancel?.();
    p.task = null;
    p.rendered = false;
    p.canvas.width = 0;
    p.canvas.height = 0;
    p.textLayer.replaceChildren();
  };

  const renderPage = async (p) => {
    if (p.rendered || p.rendering || signal.aborted) return;
    p.rendering = true;
    const renderScale = scale;
    try {
      const page = await doc.getPage(p.n);
      const viewport = page.getViewport({ scale: renderScale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
      p.canvas.width = Math.floor(viewport.width * ratio);
      p.canvas.height = Math.floor(viewport.height * ratio);
      const ctx = p.canvas.getContext('2d');
      p.task = page.render({ canvasContext: ctx, canvas: p.canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      await p.task.promise;
      if (signal.aborted || renderScale !== scale) return;
      p.textLayer.replaceChildren();
      p.el.style.setProperty('--scale-factor', String(renderScale));
      p.el.style.setProperty('--total-scale-factor', String(renderScale));
      p.el.style.setProperty('--user-unit', '1');
      const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: p.textLayer, viewport });
      await tl.render();
      p.rendered = true;
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException' && !signal.aborted) console.warn('[dsh-paper-reader] page render failed', p.n, err);
    } finally {
      p.rendering = false;
      p.task = null;
    }
    if (!p.rendered && p.visible && !signal.aborted) queueMicrotask(() => renderPage(p));
  };

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const p = pages.find((x) => x.el === e.target);
        if (!p) continue;
        p.visible = e.isIntersecting;
        if (e.isIntersecting) renderPage(p);
      }
    },
    { rootMargin: '800px 0px' },
  );

  let resizeTimer = 0;
  let lastWidth = 0;
  const ro = new ResizeObserver(() => {
    const w = root.clientWidth;
    if (!pages.length || Math.abs(w - lastWidth) < 4) return;
    lastWidth = w;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const next = fitScale();
      if (Math.abs(next - scale) < 0.01) return;
      scale = next;
      closePopovers();
      for (const p of pages) {
        unrender(p);
        sizePage(p);
        drawHighlights(p);
        if (p.visible) renderPage(p);
      }
    }, 150);
  });

  // ── highlights ──────────────────────────────────────────────────────
  const colorOf = (key) => COLORS.find((c) => c.key === key) || COLORS[0];

  function drawHighlights(p) {
    p.hl.replaceChildren();
    for (const h of highlights) {
      if (h.page !== p.n) continue;
      for (const b of h.boxes) {
        const d = el('div', { 'data-hl': h.id });
        d.style.cssText = `left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%;background:${colorOf(h.color).fill}`;
        if (current?.highlightId === h.id) d.classList.add('dpr-active');
        p.hl.append(d);
      }
    }
    if (current && !current.highlightId && current.page === p.n) {
      for (const b of current.boxes) {
        const d = el('div', { class: 'dpr-pending' });
        d.style.cssText = `left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%`;
        p.hl.append(d);
      }
    }
  }
  const redraw = (n) => {
    const p = pages[n - 1];
    if (p) drawHighlights(p);
  };

  function commitHighlight(withColor) {
    if (!current) return null;
    if (current.highlightId) {
      const h = highlights.find((x) => x.id === current.highlightId);
      if (h && withColor) h.color = withColor;
      saveHighlights(opts.storageKey, highlights);
      redraw(current.page);
      return h;
    }
    const h = { id: uid(), page: current.page, text: current.text, boxes: current.boxes, color: withColor || color, createdAt: Date.now() };
    highlights.push(h);
    current.highlightId = h.id;
    saveHighlights(opts.storageKey, highlights);
    redraw(h.page);
    return h;
  }

  function deleteHighlight(id) {
    const h = highlights.find((x) => x.id === id);
    highlights = highlights.filter((x) => x.id !== id);
    saveHighlights(opts.storageKey, highlights);
    if (h) redraw(h.page);
  }

  // ── selection → toolbar ─────────────────────────────────────────────
  function closePopovers() {
    barEl?.remove();
    cardEl?.remove();
    barEl = cardEl = null;
    const was = current;
    current = null;
    if (was) redraw(was.page);
  }

  /** Position relative to root from a page-relative box. */
  function anchorOf(page, box, edge) {
    const p = pages[page - 1];
    const pr = p.el.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const x = pr.left - rr.left + box.x * pr.width;
    const y = pr.top - rr.top + (edge === 'bottom' ? (box.y + box.h) * pr.height : box.y * pr.height);
    return { x, y };
  }

  function placeAt(node, x, y) {
    const maxLeft = root.clientWidth - node.offsetWidth - 8;
    const left = Math.max(8, Math.min(x - 14, maxLeft));
    node.style.left = `${left}px`;
    node.style.top = `${y}px`;
    node.style.setProperty('--dpr-caret', `${Math.max(10, Math.min(x - left - 5, node.offsetWidth - 20))}px`);
  }

  function showBar() {
    barEl?.remove();
    cardEl?.remove();
    cardEl = null;
    const existing = current.highlightId ? highlights.find((h) => h.id === current.highlightId) : null;
    const activeColor = existing?.color || null;
    const btn = (label, cls, onclick, extra = {}) =>
      el('button', { type: 'button', class: cls, onclick: (e) => (e.stopPropagation(), onclick()), ...extra }, ...(Array.isArray(label) ? label : [label]));
    const spark = el('span', { html: ICON.spark });
    spark.style.display = 'flex';
    barEl = el(
      'div',
      { class: 'dpr-bar', role: 'toolbar', 'aria-label': '选中文字的操作' },
      btn([spark, '问 DeepSeek'], 'dpr-primary', () => showCard()),
      btn('解释', '', () => send('这段话是什么意思？请结合上下文解释。')),
      btn('翻译', '', () => send('把这段话翻译成中文，术语保留英文原文。')),
      el('span', { class: 'dpr-sep' }),
      ...COLORS.map((c) => {
        const dot = el('span');
        dot.style.background = c.fill.replace(/[\d.]+\)$/, '0.9)');
        return btn(dot, 'dpr-swatch', () => {
          color = c.key;
          commitHighlight(c.key);
          closePopovers();
        }, { 'aria-label': c.name, title: c.name, 'aria-pressed': String(activeColor === c.key) });
      }),
      el('span', { class: 'dpr-sep' }),
      btn(el('span', { html: ICON.copy }), 'dpr-icon', async () => {
        try {
          await navigator.clipboard.writeText(current.text);
          showToast('已复制');
        } catch {
          showToast('复制失败');
        }
        closePopovers();
      }, { 'aria-label': '复制', title: '复制' }),
      existing
        ? btn(el('span', { html: ICON.trash }), 'dpr-icon', () => {
            deleteHighlight(existing.id);
            closePopovers();
          }, { 'aria-label': '删除高亮', title: '删除高亮' })
        : null,
    );
    for (const s of barEl.querySelectorAll('span[html]')) s.removeAttribute('html');
    root.append(barEl);
    const first = current.boxes[0];
    const top = anchorOf(current.page, first, 'top');
    const rr = root.getBoundingClientRect();
    const roomAbove = rr.top + top.y > 70;
    if (roomAbove) placeAt(barEl, top.x, top.y);
    else {
      barEl.classList.add('below');
      const last = current.boxes[current.boxes.length - 1];
      const b = anchorOf(current.page, last, 'bottom');
      placeAt(barEl, top.x, b.y);
    }
  }

  function showCard() {
    barEl?.remove();
    barEl = null;
    cardEl?.remove();
    const c = colorOf(highlights.find((h) => h.id === current.highlightId)?.color || color);
    const input = el('input', { type: 'text', id: 'dpr-ask-input', placeholder: '问点什么，或选上面的问题', autocomplete: 'off' });
    const sendBtn = el('button', { type: 'button', 'aria-label': '发送', html: ICON.send });
    const foot = el('div', { class: 'dpr-card-foot' }, `Enter 发送，回答会出现在${opts.askTargetLabel || '对话'}里`);
    const quoteBar = el('span', { class: 'dpr-card-quote-bar' });
    quoteBar.style.background = c.bar;
    const submit = async (q) => {
      q = String(q || '').trim();
      if (!q) return input.focus();
      input.disabled = sendBtn.disabled = true;
      foot.classList.remove('dpr-error');
      foot.textContent = '正在发送…';
      const ok = await send(q, { keepOpenOnError: true });
      if (!ok && cardEl) {
        input.disabled = sendBtn.disabled = false;
      }
    };
    sendBtn.addEventListener('click', () => submit(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        submit(input.value);
      }
    });
    cardEl = el(
      'div',
      { class: 'dpr-card', role: 'dialog', 'aria-label': '向 DeepSeek 提问' },
      el(
        'div',
        { class: 'dpr-card-head' },
        quoteBar,
        el('div', { class: 'dpr-card-body' }, el('div', { class: 'dpr-card-meta' }, `第 ${current.page} 页 · 已选中 ${current.text.length} 字`), el('div', { class: 'dpr-card-quote', title: current.text }, current.text)),
        el('button', { type: 'button', class: 'dpr-card-x', 'aria-label': '收起', html: ICON.close, onclick: () => showBar() }),
      ),
      el('div', { class: 'dpr-chips' }, ...PRESETS.map((q) => el('button', { type: 'button', onclick: () => submit(q) }, q))),
      el('div', { class: 'dpr-ask' }, el('label', { class: 'dpr-sr', for: 'dpr-ask-input' }, '问题'), input, sendBtn),
      foot,
    );
    cardEl.__foot = foot;
    root.append(cardEl);
    const last = current.boxes[current.boxes.length - 1];
    const b = anchorOf(current.page, last, 'bottom');
    const first = anchorOf(current.page, current.boxes[0], 'top');
    placeAt(cardEl, first.x, b.y);
    input.focus({ preventScroll: true });
  }

  async function send(question, { keepOpenOnError = false } = {}) {
    if (!current) return false;
    const sel = current;
    commitHighlight();
    try {
      await textsReady;
    } catch {}
    const context = buildContext(pageTexts, sel.page, sel.text);
    try {
      await opts.ask({ question, selection: sel.text, page: sel.page, context });
      closePopovers();
      showToast(`已发送到${opts.askTargetLabel || '对话'}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (keepOpenOnError && cardEl) {
        cardEl.__foot.textContent = msg;
        cardEl.__foot.classList.add('dpr-error');
      } else {
        closePopovers();
        showToast(msg);
      }
      return false;
    }
  }

  function selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const pageEl = startEl?.closest?.('.dpr-page');
    if (!pageEl || !root.contains(pageEl)) return null;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const p = pages.find((x) => x.el === pageEl);
    const boxes = rectsToBoxes([...range.getClientRects()], pageEl.getBoundingClientRect());
    if (!p || !boxes.length) return null;
    return { page: p.n, text, boxes };
  }

  function highlightAt(evt) {
    const pageEl = evt.target?.closest?.('.dpr-page');
    if (!pageEl) return null;
    const p = pages.find((x) => x.el === pageEl);
    const r = pageEl.getBoundingClientRect();
    const fx = (evt.clientX - r.left) / r.width;
    const fy = (evt.clientY - r.top) / r.height;
    for (let i = highlights.length - 1; i >= 0; i--) {
      const h = highlights[i];
      if (h.page !== p.n) continue;
      if (h.boxes.some((b) => fx >= b.x && fx <= b.x + b.w && fy >= b.y && fy <= b.y + b.h)) return h;
    }
    return null;
  }

  const onPointerUp = (evt) => {
    if (evt.button !== 0) return;
    if (barEl?.contains(evt.target) || cardEl?.contains(evt.target)) return;
    setTimeout(() => {
      if (signal.aborted) return;
      const info = selectionInfo();
      if (info) {
        const prev = current;
        current = info;
        if (prev && prev.page !== info.page) redraw(prev.page);
        redraw(info.page);
        showBar();
        return;
      }
      const h = highlightAt(evt);
      if (h) {
        const prev = current;
        current = { page: h.page, text: h.text, boxes: h.boxes, highlightId: h.id };
        if (prev) redraw(prev.page);
        redraw(h.page);
        showBar();
        return;
      }
      closePopovers();
    }, 0);
  };
  const onDocPointerDown = (evt) => {
    if (!root.contains(evt.target)) closePopovers();
  };
  const onKey = (evt) => {
    if (evt.key === 'Escape' && (barEl || cardEl)) {
      closePopovers();
      window.getSelection()?.removeAllRanges();
    }
  };
  root.addEventListener('pointerup', onPointerUp, { signal });
  document.addEventListener('pointerdown', onDocPointerDown, { signal, capture: true });
  root.addEventListener('keydown', onKey, { signal });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && onKey(e), { signal });

  // ── load ────────────────────────────────────────────────────────────
  (async () => {
    try {
      pdfjs = await import(/* @vite-ignore */ opts.pdfjsUrl);
      pdfjs.GlobalWorkerOptions.workerSrc = opts.workerUrl;
      const task = pdfjs.getDocument({ data: opts.data.slice(), isEvalSupported: false });
      signal.addEventListener('abort', () => task.destroy());
      doc = await task.promise;
      if (signal.aborted) return;
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const canvas = el('canvas', { 'aria-hidden': 'true' });
        const hl = el('div', { class: 'dpr-hl' });
        const textLayer = el('div', { class: 'textLayer' });
        const pageEl = el('div', { class: 'dpr-page', 'data-page': n, role: 'region', 'aria-label': `第 ${n} 页` }, canvas, hl, textLayer, el('span', { class: 'dpr-pageno', 'aria-hidden': 'true' }, String(n)));
        pages.push({ n, el: pageEl, canvas, hl, textLayer, base: { w: vp.width, h: vp.height }, rendered: false, rendering: false, visible: false });
      }
      scale = fitScale();
      lastWidth = root.clientWidth;
      for (const p of pages) {
        sizePage(p);
        drawHighlights(p);
        pagesEl.append(p.el);
        io.observe(p.el);
      }
      statusEl.remove();
      ro.observe(root);
      textsReady = (async () => {
        for (const p of pages) {
          if (signal.aborted) return;
          const page = await doc.getPage(p.n);
          const tc = await page.getTextContent();
          let s = '';
          for (const it of tc.items) {
            if (typeof it.str !== 'string') continue;
            s += it.str;
            s += it.hasEOL ? '\n' : it.str && !/\s$/.test(it.str) ? ' ' : '';
          }
          pageTexts[p.n - 1] = s;
        }
      })();
    } catch (err) {
      if (signal.aborted) return;
      console.error('[dsh-paper-reader] failed to open PDF', err);
      statusEl.textContent = err?.name === 'PasswordException' ? '这个 PDF 有密码保护，暂时打不开。' : `PDF 打开失败：${err?.message || err}`;
      statusEl.setAttribute('role', 'alert');
    }
  })();

  return {
    dispose() {
      ac.abort();
      io.disconnect();
      ro.disconnect();
      clearTimeout(resizeTimer);
      clearTimeout(toastTimer);
      for (const p of pages) p.task?.cancel?.();
      doc?.destroy?.();
      root.remove();
    },
  };
}
