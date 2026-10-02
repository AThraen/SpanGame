// Tiny static file server for the repo (no dependencies). Service workers / PWA install need http(s).
// Usage: node tools/serve.js [port=8080] [root=repo]     then open http://localhost:8080/
// In code: const { serve } = require('./serve'); const s = await serve({ port: 0 }); s.url; s.close();
//   opts.transform(relPath, buffer) -> buffer|null lets tests change what is served (e.g. a new sw.js).
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

function serve(opts = {}) {
  const root = path.resolve(opts.root || path.join(__dirname, '..'));
  const quiet = opts.quiet !== false;
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, path.normalize(rel));
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); if (!quiet) console.log('404', rel); return; }
      const relPath = path.relative(root, file).split(path.sep).join('/');
      if (opts.transform) { const t = opts.transform(relPath, buf); if (t != null) buf = t; }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Content-Length': buf.length,
      });
      res.end(req.method === 'HEAD' ? undefined : buf);
      if (!quiet) console.log('200', rel);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port || 0, opts.host || '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, url: 'http://localhost:' + port + '/', close: () => new Promise(r => server.close(() => r())) });
    });
  });
}

if (require.main === module) {
  const port = +(process.argv[2] || 8080);
  serve({ port, root: process.argv[3], quiet: false, host: '0.0.0.0' }).then(s => {
    console.log('SPAN served at http://localhost:' + s.port + '/  (root ' + path.resolve(process.argv[3] || path.join(__dirname, '..')) + ')');
    console.log('Phones on the same network: http://<this-pc-ip>:' + s.port + '/ (service workers need https or localhost)');
  }).catch(e => { console.error(e.message); process.exit(1); });
}
module.exports = { serve };
