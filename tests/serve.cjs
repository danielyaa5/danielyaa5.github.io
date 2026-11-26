const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.pdf': 'application/pdf' };
function createServer() {
  return http.createServer((request, response) => {
    try {
      let file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
      if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403); return response.end(); }
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      const content = fs.readFileSync(file);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}
module.exports = createServer;
if (require.main === module) createServer().listen(Number(process.argv[2] || 4173), process.env.PREVIEW_BIND || '127.0.0.1', () => console.log('Local fixture server ready'));
