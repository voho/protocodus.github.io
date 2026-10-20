#!/usr/bin/env node
import {createServer} from 'node:http';
import {createReadStream, statSync} from 'node:fs';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

// Shared by local play and the browser checks. MP3 streaming requires bounded byte ranges.
export function startStaticServer(root, port = 0) {
  const ROOT = resolve(root);
  const server = createServer((request, response) => {
    let url, path;
    try { url = new URL(request.url, 'http://localhost'); path = decodeURIComponent(url.pathname); }
    catch { response.writeHead(400).end(); return; }
    let file = resolve(ROOT, `.${path}`), stats;
    if (file !== ROOT && !file.startsWith(ROOT + sep)) { response.writeHead(403).end(); return; }
    try {
      stats = statSync(file);
      if (stats.isDirectory()) {
        if (!url.pathname.endsWith('/')) { response.writeHead(301, { Location: `${url.pathname}/${url.search}` }).end(); return; }
        file = join(file, 'index.html'); stats = statSync(file);
      }
    } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    const modified = new Date(Math.floor(stats.mtimeMs / 1000) * 1000), since = Date.parse(request.headers['if-modified-since'] ?? '');
    if (!request.headers.range && since >= modified.getTime()) { response.writeHead(304).end(); return; }
    const headers = { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stats.size, 'Last-Modified': modified.toUTCString(), 'Accept-Ranges': 'bytes' };
    const range = request.headers.range;
    if (range && (!request.headers['if-range'] || Date.parse(request.headers['if-range']) >= modified.getTime())) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      let start = match?.[1] ? Number(match[1]) : Math.max(0, stats.size - Number(match?.[2]));
      let end = match?.[1] && match[2] ? Number(match[2]) : stats.size - 1;
      if (!match || !match[1] && !match[2] || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= stats.size || end < start) {
        response.writeHead(416, { 'Content-Range': `bytes */${stats.size}` }).end(); return;
      }
      end = Math.min(end, stats.size - 1);
      response.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stats.size}` });
      if (request.method === 'HEAD') { response.end(); return; }
      createReadStream(file, {start, end}).on('error', () => response.destroy()).pipe(response);
      return;
    }
    response.writeHead(200, headers);
    if (request.method === 'HEAD') { response.end(); return; }
    createReadStream(file).on('error', () => response.destroy()).pipe(response);
  });
  return new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', () => done(server)); });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 8000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('Usage: node fun/ashline/tools/serve.mjs [port]');
    process.exitCode = 1;
  } else {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const server = await startStaticServer(root, port);
    console.log(`Ashline: http://localhost:${server.address().port}/fun/ashline/`);
  }
}
