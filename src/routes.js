// HTTP routes under /paper-reader: the browser-side viewer modules, pdf.js, and
// the endpoint that sends a question into a dsh session. Free of dsh imports so
// the dev server and tests can use it directly.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatQuestion } from './prompt.js';

const require = createRequire(import.meta.url);
const READER_DIR = fileURLToPath(new URL('../reader/', import.meta.url));
const PDFJS_DIR = dirname(require.resolve('pdfjs-dist/package.json'));
const VENDOR = {
  'pdf.min.mjs': join(PDFJS_DIR, 'build', 'pdf.min.mjs'),
  'pdf.worker.min.mjs': join(PDFJS_DIR, 'build', 'pdf.worker.min.mjs'),
};
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.pdf': 'application/pdf',
};
const MAX_JSON = 256 * 1024;

function json(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store' });
  res.end(buf);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_JSON) throw Object.assign(new Error('请求太大'), { status: 413 });
    chunks.push(c);
  }
  if (!size) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 });
  }
}

async function sendFile(res, path, cache) {
  let s;
  try {
    s = await stat(path);
  } catch {
    return json(res, 404, { error: 'not found' });
  }
  if (!s.isFile()) return json(res, 404, { error: 'not found' });
  res.writeHead(200, { 'content-type': MIME[extname(path).toLowerCase()] || 'application/octet-stream', 'content-length': s.size, 'cache-control': cache });
  createReadStream(path).pipe(res);
}

/**
 * @param {{ prompt?: (args: { sessionId: string, text: string }) => Promise<void> }} deps
 *   `prompt` sends a user message into a dsh session; absent in headless/dev setups.
 */
export function createRouter({ prompt } = {}) {
  async function route(req, res, subpath) {
    const p = new URL(subpath || '/', 'http://local').pathname;
    const m = req.method || 'GET';

    if (m === 'GET' && p.startsWith('/static/')) {
      let rel;
      try {
        rel = normalize(decodeURIComponent(p.slice('/static/'.length)));
      } catch {
        return json(res, 400, { error: 'bad path' });
      }
      const full = join(READER_DIR, rel);
      if (rel.startsWith('..') || rel.includes(`..${sep}`) || !full.startsWith(READER_DIR)) return json(res, 400, { error: 'bad path' });
      return sendFile(res, full, 'no-cache');
    }
    if (m === 'GET' && p.startsWith('/vendor/')) {
      const file = VENDOR[p.slice('/vendor/'.length)];
      if (!file) return json(res, 404, { error: 'not found' });
      return sendFile(res, file, 'max-age=86400');
    }

    if (m === 'POST' && p === '/api/ask') {
      const body = await readJson(req);
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      if (!String(body.question || '').trim()) return json(res, 400, { error: '问题不能为空' });
      if (!String(body.selection || '').trim()) return json(res, 400, { error: '没有选中的原文' });
      if (!sessionId) return json(res, 400, { error: '找不到当前会话' });
      if (!prompt) return json(res, 503, { error: '当前 dsh 环境不支持向会话发送消息' });
      const text = formatQuestion(body);
      await prompt({ sessionId, text });
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'not found' });
  }

  return async (req, res, subpath) => {
    try {
      await route(req, res, subpath);
    } catch (err) {
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
      }
      const status = err?.status || 500;
      json(res, status, { error: status === 500 ? '发送失败：' + (err?.message || String(err)) : err.message });
      if (status === 500) console.error('[dsh-paper-reader]', err);
    }
  };
}

