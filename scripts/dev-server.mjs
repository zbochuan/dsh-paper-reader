// Local preview of the viewer without dsh: serves reader/dev.html, a sample PDF,
// and the plugin routes, with questions shown on the page instead of sent to a session.
//   python3 scripts/make-sample-pdf.py .data/sample.pdf && npm run dev
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRouter } from '../src/routes.js';

const PORT = Number(process.env.PORT || 4317);
const SAMPLE = process.env.SAMPLE_PDF || new URL('../.data/sample.pdf', import.meta.url);
const listeners = new Set();

const handle = createRouter({
  prompt: async ({ text }) => {
    for (const res of listeners) res.write(`data: ${JSON.stringify({ text })}\n\n`);
  },
});

createServer(async (req, res) => {
  const url = req.url || '/';
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(await readFile(new URL('../reader/dev.html', import.meta.url)));
  }
  if (url === '/sample.pdf') {
    res.writeHead(200, { 'content-type': 'application/pdf' });
    return res.end(await readFile(SAMPLE));
  }
  if (url === '/dev/messages') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(': ok\n\n');
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
    return;
  }
  if (url.startsWith('/paper-reader/')) return handle(req, res, url.slice('/paper-reader'.length));
  res.writeHead(404).end();
}).listen(PORT, () => console.log(`dev preview: http://localhost:${PORT}/`));
