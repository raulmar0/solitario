// Servidor estático mínimo para desarrollo. Sin dependencias.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, rel === '/' || rel === '\\' ? 'index.html' : rel);
    // Nada de salir de la carpeta ni de servir .git, node_modules y demás.
    const dentro = file === ROOT || file.startsWith(ROOT + sep);
    const oculto = file.slice(ROOT.length).split(sep).some((parte) => parte.startsWith('.') || parte === 'node_modules');
    if (!dentro || oculto) { res.writeHead(403).end('Prohibido'); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }).end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
  }
}).listen(PORT, HOST, () => {
  console.log(`Solitario en http://${HOST}:${PORT}`);
});
