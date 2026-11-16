import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const port = Number(process.env.PORT) || 4321;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

if (!fs.existsSync(root)) {
  console.error('! public/ 不存在，请先运行 npm run build');
  process.exit(1);
}

http
  .createServer((req, res) => {
    const rawPath = (req.url || '/').split('?')[0];
    let decoded;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Bad Request');
      return;
    }
    let file = path.join(root, decoded);

    if (!file.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

    // 路径不存在时输出 404.html 内容，但状态码必须是 404
    const notFound = !fs.existsSync(file);
    if (notFound) file = path.join(root, '404.html');
    if (notFound && !fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }

    const ext = path.extname(file).toLowerCase();
    res.writeHead(notFound ? 404 : 200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`预览服务已启动：http://localhost:${port}`));
