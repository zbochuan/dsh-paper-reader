import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, name } from '../src/index.js';

function fakeCtx({ rejection } = {}) {
  const registered = [];
  const prompts = [];
  const ctx = {
    effect: (fn) => fn(),
    inject: (deps, cb) =>
      cb({
        webServer: { register: (r) => (registered.push(r), () => {}) },
        connection: { requestRejection: () => rejection },
        sessionController: { prompt: async (args) => prompts.push(args) },
      }),
  };
  return { ctx, registered, prompts };
}

function call(handler, method, url, body) {
  return new Promise((resolve) => {
    const req = (async function* () {
      if (body) yield Buffer.from(JSON.stringify(body));
    })();
    Object.assign(req, { method, url, headers: {} });
    const res = {
      status: 0,
      headersSent: false,
      writableEnded: false,
      writeHead(s) {
        this.status = s;
        this.headersSent = true;
        return this;
      },
      end(b) {
        this.writableEnded = true;
        resolve({ status: this.status, body: b ? JSON.parse(String(b)) : null });
      },
    };
    handler(req, res);
  });
}

test('registers the /paper-reader prefix and forwards questions to the session', async () => {
  assert.equal(name, 'dsh-paper-reader');
  const { ctx, registered, prompts } = fakeCtx();
  apply(ctx);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].kind, 'prefix');
  assert.equal(registered[0].path, '/paper-reader');
  const r = await call(registered[0].handler, 'POST', '/paper-reader/api/ask', { sessionId: 'abc', question: 'q', selection: 'text' });
  assert.equal(r.status, 200);
  assert.equal(prompts[0].sessionId, 'abc');
  assert.equal(prompts[0].content[0].type, 'text');
  assert.ok(prompts[0].requestId);
});

test('refuses requests the connection rejects', async () => {
  const { ctx, registered, prompts } = fakeCtx({ rejection: 401 });
  apply(ctx);
  const r = await call(registered[0].handler, 'POST', '/paper-reader/api/ask', { sessionId: 'abc', question: 'q', selection: 'text' });
  assert.equal(r.status, 401);
  assert.equal(prompts.length, 0);
});
