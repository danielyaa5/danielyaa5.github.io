const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'analytics.js'), 'utf8');
const version = source.match(/const ANALYTICS_VERSION = '(\d+)'/)?.[1];
assert.ok(version);
function walk(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(item => {
    if (['.git', 'node_modules', 'test-results'].includes(item.name)) return [];
    const file = path.join(folder, item.name);
    return item.isDirectory() ? walk(file) : file.endsWith('.html') ? [file] : [];
  });
}
let pages = 0;
for (const file of walk(root)) {
  const matches = [...fs.readFileSync(file, 'utf8').matchAll(/<script[^>]*src="\/analytics\.js\?v=([^"&]+)"/g)];
  for (const match of matches) assert.equal(match[1], version, `${path.relative(root, file)} cache key`);
  if (matches.length) { assert.equal(matches.length, 1); pages++; }
}
assert.ok(pages >= 30, 'full tracked-page inventory');
console.log(`${pages} pages request collector v${version}`);
async function run(file, args = []) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, file), ...args], { cwd: root, env: process.env, stdio: 'inherit' });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${file} timed out`)); }, 240000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${file} exited ${code}`)); });
  });
}
(async () => {
  await run('uptime.cjs');
  const server = require('./serve.cjs')();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run('analytics.cjs', [`http://127.0.0.1:${server.address().port}`]);
    await run('alerts.cjs');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  console.log('Focused alert verification passed. Live delivery and physical iPhone behavior remain rollout checks.');
})().catch(error => { console.error(error); process.exitCode = 1; });
