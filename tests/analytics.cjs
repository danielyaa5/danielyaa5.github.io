const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium } = require('playwright');

// Analytics must stay silent on local previews, skip the guest gate, and send only origin + path.
// The published host is simulated by answering its requests from the local server; PostHog's
// capture requests are intercepted and never leave the machine. POSTHOG_ARRAY_JS can point at a
// local copy of PostHog's array.js when its CDN is unreachable.
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const root = path.join(__dirname, '..');
const site = 'http://danielyakobian.com';
const tracked = ['index.html', 'blog/index.html', 'quickdesk/index.html', 'resume/index.html',
  ...fs.readdirSync(path.join(root, 'blog')).filter(name => name.endsWith('.html') && name !== 'index.html').map(name => `blog/${name}`)];
const untracked = ['gate/index.html', 'quickdesk/privacy.html'];

const events = request => {
  const raw = request.postDataBuffer();
  if (!raw) return [];
  let text = raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw).toString() : raw.toString();
  if (text.startsWith('data=')) text = Buffer.from(decodeURIComponent(text.slice(5)), 'base64').toString();
  const body = JSON.parse(text);
  return Array.isArray(body) ? body : body.batch || [body];
};

(async () => {
  for (const file of tracked) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(html.match(/<script src="\/analytics\.js\?v=\d+" defer><\/script>/g)?.length, 1, `${file} loads analytics once`);
  }
  for (const file of untracked) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /analytics\.js/, `${file} has no analytics`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'analytics.js'), 'utf8'), /POSTHOG_PROJECT_TOKEN/, 'analytics.js has the project token');

  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    // Local preview: PostHog is never contacted.
    const local = await browser.newPage();
    const analytics = [];
    local.on('request', r => { if (new URL(r.url()).hostname.endsWith('posthog.com')) analytics.push(r.url()); });
    await local.goto(`${base}/`, { waitUntil: 'networkidle' });
    assert.deepEqual(analytics, [], 'local preview sends no analytics');
    await local.close();

    // Published host: serve the site locally and catch what PostHog would receive.
    // PostHog ignores headless and automated browsers, so this one presents as a regular Chrome.
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36' });
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
    });
    const captured = [];
    await context.route(`${site}/**`, async route => {
      const url = new URL(route.request().url());
      const response = await fetch(base + url.pathname);
      await route.fulfill({ status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'text/html' }, body: Buffer.from(await response.arrayBuffer()) });
    });
    if (process.env.POSTHOG_ARRAY_JS) {
      await context.route('https://us-assets.i.posthog.com/static/array.js', route => route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(process.env.POSTHOG_ARRAY_JS) }));
    }
    await context.route(/^https:\/\/us(-assets)?\.i\.posthog\.com\/(?!static\/array\.js)/, async route => {
      if (route.request().method() === 'POST' && /\/e\/|\/i\/v0\/e\//.test(new URL(route.request().url()).pathname)) captured.push(...events(route.request()));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
    });

    const page = await context.newPage();
    await page.goto(`${site}/?utm_source=analytics-test#private-fragment`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.posthog?.__loaded === true);
    await page.evaluate(() => window.posthog.flush?.());
    await page.waitForTimeout(1500);
    const views = captured.filter(e => e.event === '$pageview');
    assert.equal(views.length, 1, 'one page view');
    const props = views[0].properties;
    assert.equal(props.$current_url, `${site}/`, 'query and fragment are removed');
    assert.equal(props.utm_source, 'analytics-test', 'campaign tags survive as their own property');
    assert.equal(props.$cookieless_mode, true, 'cookieless mode');
    assert.ok(!JSON.stringify(captured).includes('private-fragment'), 'fragment never sent');
    assert.deepEqual(await context.cookies(), [], 'no cookies');
    assert.deepEqual(await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter(key => /ph_|posthog/i.test(key))), [], 'no PostHog storage');

    // The guest gate page never loads analytics.
    const before = captured.length;
    const gateRequests = [];
    const gate = await context.newPage();
    gate.on('request', r => gateRequests.push(r.url()));
    await gate.goto(`${site}/gate/`, { waitUntil: 'networkidle' });
    assert.ok(!gateRequests.some(url => /analytics\.js|posthog/.test(url)), 'gate page loads no analytics');
    assert.equal(captured.length, before, 'gate page sends nothing');
    console.log(`Analytics checks passed: ${tracked.length} tracked pages, ${untracked.length} untracked, cookieless page view without query or fragment.`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
