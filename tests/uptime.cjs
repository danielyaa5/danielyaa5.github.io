// Focused integration fixtures: run the real monitor against loopback only, with no credentials or dependencies.
// Run on the authorized test host: node tests/uptime.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, '.github/scripts/uptime.cjs');
const analytics = fs.readFileSync(path.join(root, 'analytics.js'), 'utf8');
const version = analytics.match(/^\s*const ANALYTICS_VERSION = ['"]([0-9]+)['"];\s*$/m)?.[1];
const token = analytics.match(/^\s*const TOKEN = ['"](phc_[A-Za-z0-9]+)['"];\s*$/m)?.[1];
assert.ok(version && token, 'local analytics deployment markers exist');
const configPath = `/dy-relay/array/${token}/config/`;
const cmsPages = [
  ['/cloud-media-shrinker/', 'cloud-media-shrinker/index.html'],
  ['/cloud-media-shrinker/help/', 'cloud-media-shrinker/help/index.html'],
  ['/cloud-media-shrinker/whats-new/', 'cloud-media-shrinker/whats-new/index.html'],
];
const pages = new Map(cmsPages.map(([url, file]) => [url, fs.readFileSync(path.join(root, file), 'utf8')]));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-fixtures-'));
const guard = path.join(temp, 'loopback-only.cjs');
fs.writeFileSync(guard, `
const nativeFetch = global.fetch;
global.fetch = (url, options = {}) => {
  if (new URL(url).origin !== process.env.FIXTURE_ORIGIN) {
    console.error('FORBIDDEN_EXTERNAL_REQUEST', String(url));
    throw new Error('fixture blocked an external request');
  }
  // Never allow an internal redirect to evade this origin check.
  return nativeFetch(url, { ...options, redirect: 'manual' });
};
require('node:tls').connect = () => {
  console.error('FORBIDDEN_EXTERNAL_REQUEST TLS');
  throw new Error('fixture blocked TLS');
};
`);

async function fixture(options = {}) {
  const requests = [];
  const existing = { number: 41, title: options.openTest ? 'Site check failed (test, not a real outage)' : 'Site check failed: previous outage', html_url: 'https://github.invalid/issues/41' };
  let origin;
  const server = http.createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const url = new URL(request.url, origin);
    const entry = { method: request.method, path: url.pathname, body: text ? JSON.parse(text) : null };
    requests.push(entry);
    const reply = (status, body, headers = {}) => {
      response.writeHead(status, headers);
      response.end(typeof body === 'string' ? body : JSON.stringify(body));
      entry.replied = true;
    };
    if (url.pathname.startsWith('/github/')) {
      if (options.githubFailure) return reply(500, { error: 'fixture failure' });
      if (request.method === 'GET') return reply(200, options.open ? [existing] : []);
      if (request.method === 'POST' && url.pathname.endsWith('/issues')) return reply(201, existing);
      return reply(200, {});
    }
    if (url.pathname === '/slack') {
      // Force the monitor to await the notification before it can exit.
      return setTimeout(() => reply(options.slackFailure ? 500 : 200, 'ok'), 30);
    }
    if (url.pathname === options.failPath) return reply(options.failStatus || 503, options.failBody || 'fixture outage');
    if (url.pathname === '/www/') return reply(308, '', { Location: `${origin}/` });
    if (url.pathname === '/api/subscribe/') {
      assert.equal(request.headers.accept, 'application/json');
      return reply(405, { error: 'method_not_allowed' });
    }
    if (url.pathname === '/analytics.js') {
      let body = analytics;
      if (options.staleVersion) body = body.replace(/const ANALYTICS_VERSION = ['"][0-9]+['"];/, "const ANALYTICS_VERSION = '0';");
      if (options.missingMarker) body = body.replace(/\banalytics_version:/g, 'removed_version:');
      return reply(200, body);
    }
    if (url.pathname === '/dy-relay/static/array.js') return reply(200, 'window.posthog = {};');
    if (url.pathname === configPath) return reply(200, options.badConfig ? '<html>not remote config</html>' : { autocapture: true });
    if (pages.has(url.pathname)) return reply(200, pages.get(url.pathname));
    if (['/', '/resume/', '/motorcycle-rentals/', '/blog/', '/mirror/'].includes(url.pathname)) return reply(200, 'Daniel Yakobian');
    return reply(404, 'unknown fixture route');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const summary = path.join(temp, 'summary.md');
  fs.writeFileSync(summary, '');
  try {
    const env = {
      FIXTURE_ORIGIN: origin,
      UPTIME_SITE: origin,
      UPTIME_WWW: `${origin}/www`,
      UPTIME_MIRROR: `${origin}/mirror`,
      UPTIME_ATTEMPTS: '1',
      UPTIME_RETRY_WAIT_MS: '0',
      UPTIME_TEST_ALERT: String(Boolean(options.synthetic)),
      GITHUB_STEP_SUMMARY: summary,
      ...(options.local ? {} : {
        GITHUB_API_URL: `${origin}/github`,
        GITHUB_REPOSITORY: 'fixture/site',
        GITHUB_TOKEN: 'fixture-only',
        GITHUB_SERVER_URL: 'https://github.invalid',
        GITHUB_RUN_ID: '123',
        SLACK_WEBHOOK_URL: `${origin}/slack`,
      }),
    };
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--require', guard, script], { cwd: root, env });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      const timer = setTimeout(() => { child.kill(); reject(new Error('uptime fixture timed out')); }, 15000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
    });
    assert.equal(result.signal, null, result.output);
    assert.doesNotMatch(result.output, /FORBIDDEN_EXTERNAL_REQUEST/, result.output);
    assert.ok(requests.every(request => request.replied), 'all requested notifications finish before process exit');
    return { ...result, requests, summary: fs.readFileSync(summary, 'utf8') };
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

const mutations = result => result.requests.filter(r => r.path.startsWith('/github/') && r.method !== 'GET');
const notifications = result => result.requests.filter(r => r.path === '/slack');
async function check(name, options, expectedCode, inspect = () => {}) {
  const result = await fixture(options);
  assert.equal(result.code, expectedCode, `${name}\n${result.output}`);
  inspect(result);
  console.log(`ok ${name}`);
}

(async () => {
  await check('healthy with no issue', {}, 0, result => {
    assert.equal(mutations(result).length, 0);
    assert.equal(notifications(result).length, 0);
    for (const [url] of cmsPages) assert.ok(result.requests.some(r => r.path === url));
    assert.ok(result.requests.some(r => r.path === configPath));
    assert.match(result.summary, /Every check passes/);
  });
  await check('real failure opens issue and completes Slack before failed exit', { failPath: '/' }, 1, result => {
    assert.deepEqual(mutations(result).map(r => [r.method, r.path]), [['POST', '/github/repos/fixture/site/issues']]);
    assert.match(mutations(result)[0].body.title, /Home page/);
    assert.match(notifications(result)[0].body.text, /:red_circle:/);
    assert.match(result.output, /Posted to Slack/);
    assert.match(result.summary, /Home page/);
  });
  await check('continued failure updates issue without another notification', { failPath: '/', open: true }, 1, result => {
    assert.deepEqual(mutations(result).map(r => [r.method, r.path]), [['PATCH', '/github/repos/fixture/site/issues/41']]);
    assert.equal(notifications(result).length, 0);
  });
  await check('recovery comments, closes issue, and notifies', { open: true }, 0, result => {
    assert.deepEqual(mutations(result).map(r => [r.method, r.path]), [
      ['POST', '/github/repos/fixture/site/issues/41/comments'], ['PATCH', '/github/repos/fixture/site/issues/41'],
    ]);
    assert.match(mutations(result)[0].body.body, /Back up:/);
    assert.equal(mutations(result)[1].body.state, 'closed');
    assert.match(notifications(result)[0].body.text, /:large_green_circle:/);
  });
  await check('local failure still fails without credentials', { local: true, failPath: '/' }, 1, result => {
    assert.equal(result.requests.filter(r => r.path.startsWith('/github/') || r.path === '/slack').length, 0);
  });
  await check('local healthy run succeeds', { local: true }, 0);
  await check('synthetic-only alert succeeds and labels its notification', { synthetic: true }, 0, result => {
    assert.match(mutations(result)[0].body.title, /test, not a real outage/);
    assert.match(notifications(result)[0].body.text, /:test_tube:/);
  });
  await check('real failure plus synthetic alert still fails and reports outage', { synthetic: true, failPath: '/' }, 1, result => {
    assert.doesNotMatch(mutations(result)[0].body.title, /\(test, not a real outage\)/);
    assert.match(notifications(result)[0].body.text, /:red_circle:/);
  });
  await check('real failure removes existing synthetic issue label', { open: true, openTest: true, failPath: '/' }, 1, result => {
    assert.equal(mutations(result)[0].body.title, 'Site check failed: Home page');
    assert.equal(notifications(result).length, 0);
  });
  await check('local synthetic-only alert succeeds', { local: true, synthetic: true }, 0);
  await check('local real plus synthetic failure fails', { local: true, synthetic: true, failPath: '/' }, 1);
  await check('Slack failure preserves issue handling and failed exit', { failPath: '/', slackFailure: true }, 1, result => {
    assert.equal(mutations(result).length, 1);
    assert.match(result.output, /Slack post failed/);
  });
  await check('Slack failure does not fail healthy recovery', { open: true, slackFailure: true }, 0);
  await check('GitHub failure remains a failed run', { githubFailure: true }, 1);
  for (const [url] of cmsPages) {
    await check(`${url} rejects failed status`, { local: true, failPath: url }, 1);
    await check(`${url} rejects wrong content`, { local: true, failPath: url, failStatus: 200, failBody: 'Daniel Yakobian fallback page' }, 1);
  }
  await check('stale analytics version fails', { local: true, staleVersion: true }, 1);
  await check('missing analytics event marker fails', { local: true, missingMarker: true }, 1);
  await check('remote config regression fails', { local: true, failPath: configPath, failStatus: 404 }, 1);
  await check('remote config must be JSON', { local: true, badConfig: true }, 1);
  console.log('Uptime fixtures passed. No live endpoints contacted.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(temp, { recursive: true, force: true });
});
