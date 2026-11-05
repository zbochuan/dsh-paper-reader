// dsh (DeepSeek Harness) host plugin. Serves the viewer modules and pdf.js under
// /paper-reader, and sends questions asked in the PDF viewer into the session
// whose right sidebar the PDF is open in. The viewer itself is registered by
// the browser half, lib/client.js.

import { randomUUID } from 'node:crypto';
import { createRouter } from './routes.js';

export const name = 'dsh-paper-reader';

const PREFIX = '/paper-reader';

export function apply(ctx) {
  // webServer exists only in profiles with a web UI (web / desktop), not headless.
  ctx.inject(['webServer', 'connection', 'sessionController'], (rctx) => {
    const { connection, sessionController } = rctx;
    const handle = createRouter({
      prompt: ({ sessionId, text }) =>
        sessionController.prompt(
          { sessionId, mode: 'queue', content: [{ type: 'text', text }], requestId: randomUUID() },
          AbortSignal.timeout(30_000),
        ),
    });

    ctx.effect(() =>
      rctx.webServer.register({
        kind: 'prefix',
        path: PREFIX,
        handler: (req, res) => {
          // Plugin routes are not covered by dsh's own auth checks, so apply them here.
          const rejection = connection?.requestRejection?.(req);
          if (rejection !== undefined) {
            res.writeHead(rejection, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: rejection === 401 ? 'unauthorized' : 'forbidden' }));
            return;
          }
          const raw = req.url || '/';
          void handle(req, res, raw.startsWith(PREFIX) ? raw.slice(PREFIX.length) || '/' : raw);
        },
      }),
    );
  });
}
