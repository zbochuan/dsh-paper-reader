import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRouter } from '../src/routes.js';

async function withServer(router, fn) {
  const server = createServer((req, res) => router(req, res, req.url));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

test('ask sends a formatted message into the session', async () => {
  const sent = [];
  await withServer(createRouter({ prompt: async (a) => sent.push(a) }), async (base) => {
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1', question: '什么意思？', selection: 'some text', page: 2 }),
    });
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].sessionId, 's1');
    assert.match(sent[0].text, /^> some text/);
  });
});

test('ask validates input', async () => {
  await withServer(createRouter({ prompt: async () => {} }), async (base) => {
    const post = (body) => fetch(`${base}/api/ask`, { method: 'POST', body: JSON.stringify(body) });
    assert.equal((await post({ selection: 'a', sessionId: 's' })).status, 400);
    assert.equal((await post({ question: 'q', sessionId: 's' })).status, 400);
    assert.equal((await post({ question: 'q', selection: 'a' })).status, 400);
  });
});

test('ask reports a missing session service', async () => {
  await withServer(createRouter({}), async (base) => {
    const res = await fetch(`${base}/api/ask`, { method: 'POST', body: JSON.stringify({ question: 'q', selection: 'a', sessionId: 's' }) });
    assert.equal(res.status, 503);
  });
});

test('static files are served and path traversal is refused', async () => {
  await withServer(createRouter({}), async (base) => {
    const ok = await fetch(`${base}/static/viewer.js`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /javascript/);
    const bad = await fetch(`${base}/static/..%2F..%2Fpackage.json`);
    assert.equal(bad.status, 400);
    const pdfjs = await fetch(`${base}/vendor/pdf.min.mjs`);
    assert.equal(pdfjs.status, 200);
    await pdfjs.arrayBuffer();
    assert.equal((await fetch(`${base}/vendor/other.js`)).status, 404);
  });
});
