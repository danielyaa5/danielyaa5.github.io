const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium, webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const sdk = process.env.POSTHOG_ARRAY_JS;
assert.ok(sdk && fs.existsSync(sdk), 'POSTHOG_ARRAY_JS must name a local SDK array.js; no network fallback');
const site = 'https://danielyakobian.com';
const version = fs.readFileSync(path.join(root, 'analytics.js'), 'utf8').match(/const ANALYTICS_VERSION = '(\d+)'/)?.[1];
assert.ok(version, 'collector declares its version');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
function decode(request) {
  const raw = Buffer.isBuffer(request) ? request : request.postDataBuffer();
  if (!raw) return [];
  let text = raw[0] === 31 && raw[1] === 139 ? zlib.gunzipSync(raw).toString() : raw.toString();
  if (text.startsWith('data=')) text = Buffer.from(new URLSearchParams(text).get('data'), 'base64').toString();
  else if (!/^\s*[\[{]/.test(text)) text = Buffer.from(text, 'base64').toString();
  const body = JSON.parse(text);
  return Array.isArray(body) ? body : body.batch || [body];
}
async function setup(browser, mobile = false, automated = false) {
  const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1440, height: 900 }, hasTouch: mobile, isMobile: mobile,
    reducedMotion: 'reduce', serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15' });
  const captured = [], requests = [], external = [], pageErrors = [], instrumentationErrors = [];
  await context.exposeBinding('recordTestBeacon', (_source, bytes) => captured.push(...decode(Buffer.from(bytes))));
  await context.addInitScript(({ automated, webkit }) => {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => automated });
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
    // Isolate the clipboard from the user's real clipboard. Verify the requested value and UI feedback.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.testClipboard = text; } } });
    // Playwright WebKit does not expose Blob beacon bodies. Copy the real SDK body
    // before native sendBeacon; the request still goes to the route fixture below.
    if (webkit) {
      const beacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (url, body) => {
        if (/\/dy-relay\/(e|i\/v0\/e)\//.test(String(url)) && body instanceof Blob)
          body.arrayBuffer().then(bytes => window.recordTestBeacon(Array.from(new Uint8Array(bytes))));
        return beacon(url, body);
      };
    }
  }, { automated, webkit: browser.browserType().name() === 'webkit' });
  // A dead browser proxy below is a second barrier for unload beacons after these routes are disposed.
  // Node reads only local files; no fetch, real sign-up, GitHub issue or analytics delivery occurs here.
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.protocol === 'blob:' || url.protocol === 'data:') return route.continue();
    if (url.origin !== site && url.origin !== 'http://localhost') {
      external.push(url.href);
      if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<p>Intercepted external destination</p>' });
      return route.abort();
    }
    if (url.pathname.startsWith('/dy-relay/')) {
      requests.push(url.pathname);
      const script = url.pathname.match(/\/static\/(?:[\d.]+\/)?([\w.-]+\.js)$/);
      if (script) {
        const file = script[1] === 'array.js' ? sdk : path.join(path.dirname(sdk), script[1]);
        assert.ok(fs.existsSync(file), `local SDK asset exists: ${script[1]}`);
        return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(file) });
      }
      if (/\/config\/?$/.test(url.pathname)) return route.fulfill({ json: { autocapture_opt_out: false, sessionRecording: false, capturePerformance: true } });
      if (request.method() === 'POST' && /\/e\/|\/i\/v0\/e\//.test(url.pathname)) captured.push(...decode(request));
      return route.fulfill({ json: { status: 1, featureFlags: {}, featureFlagPayloads: {} } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { error: 'fixture_unavailable' } });
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (file !== root && !file.startsWith(root + path.sep)) return route.abort();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'Missing fixture' });
    return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  context.on('page', page => page.on('pageerror', error => {
    // This precise failure originates in Playwright's injected WebKit inspector while
    // reading Blob requests during navigation. Keep it visible separately; don't hide SDK/site errors.
    if (browser.browserType().name() === 'webkit' && error.stack?.includes('web-inspector://bootstrap.js') &&
        /Cannot load blob:https:\/\/danielyakobian\.com\/[a-f0-9-]+ due to access control checks\./.test(error.stack))
      instrumentationErrors.push(error.stack);
    else pageErrors.push(error.message);
  }));
  async function pageAt(url) {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    if (!automated && url.startsWith(site)) await page.waitForFunction(() => window.posthog?.__loaded);
    return page;
  }
  return { context, captured, requests, external, pageErrors, instrumentationErrors, pageAt };
}
async function until(page, condition, message) {
  for (let i = 0; i < 60 && !condition(); i++) await page.waitForTimeout(100);
  assert.ok(condition(), message);
}
async function errors(run) {
  const page = await run.pageAt(site + '/cloud-media-shrinker/whats-new/?private=secret#private');
  const start = run.captured.length;
  await page.evaluate(() => {
    const reject = reason => dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: new Promise(() => {}), reason }));
    const frame = document.createElement('iframe'); document.body.append(frame);
    const foreign = new frame.contentWindow.SyntaxError('foreign original');
    foreign.stack = 'SyntaxError: foreign original\nparse@https://danielyakobian.com/original.js?secret=yes#private:7:9';
    reject(foreign);
    reject('SyntaxError: stackless string');
    reject({ name: 'TypeError', message: 'stackless object' });
    reject({ name: 'Error', message: 'external', stack: 'Error: external\n    at run (https://danielyakobian.com.evil.example/x.js?secret=yes:2:3)' });
    reject({ name: 'Error', message: 'message-only person@https://danielyakobian.com/x.js', stack: 'Error: message-only person@https://danielyakobian.com/x.js' });
    reject({ name: 'Error', message: 'chrome-extension://example/mentioned', stack: 'Error: chrome-extension://example/mentioned\n    at run (https://danielyakobian.com/actual.js:2:3)' });
    const hostile = new Proxy({}, { get() { throw new Error('getter trap'); }, ownKeys() { throw new Error('keys trap'); } });
    reject(hostile);
    const fn = () => {}; fn.toString = () => { throw new Error('conversion trap'); }; reject(fn);
    const long = { name: 'RangeError', message: 'bounded', stack: 'RangeError: bounded\n' + '    at run (https://danielyakobian.com/file.js?secret=yes:2:3)\n'.repeat(200) }; reject(long);
    reject({ name: 'Error', message: 'native no frame', stack: 'Error: native no frame' });
    reject('over page cap');
  });
  const found = () => run.captured.slice(start).filter(e => e.event === '$exception');
  await until(page, () => found().length === 10, 'ten errors reach the real SDK, including hostile inputs').catch(error => {
    console.error({ events: run.captured.map(e => [e.event, e.properties.$exception_list]), requests: run.requests, pageErrors: run.pageErrors });
    throw error;
  });
  await page.waitForTimeout(400);
  assert.equal(found().length, 10, 'page error cap');
  const by = value => found().find(e => e.properties.$exception_list[0].value.includes(value))?.properties;
  const foreign = by('foreign original');
  assert.equal(foreign.$exception_list[0].type, 'SyntaxError');
  assert.equal(foreign.error_origin, 'site');
  assert.ok(foreign.error_stack_available);
  assert.ok(JSON.stringify(foreign.$exception_list).includes('original.js'), 'foreign original frame survives SDK parsing');
  for (const value of ['stackless string', 'stackless object', 'message-only', 'native no frame']) {
    const p = by(value);
    assert.equal(p.error_origin, 'unknown', value);
    assert.equal(p.error_from_site, null, value);
    assert.equal(p.error_stack_available, false, value);
    assert.ok(!p.$exception_list[0].stacktrace?.frames?.length, 'stackless stays stackless through real SDK');
  }
  assert.equal(by('external').error_origin, 'external');
  assert.equal(by('external').error_from_site, false);
  assert.equal(by('chrome-extension://').error_origin, 'site', 'message mentioning extension is retained');
  assert.ok(by('Uninspectable object'));
  assert.ok(by('function'));
  assert.ok(!JSON.stringify(found()).includes('secret='));
  assert.ok(!JSON.stringify(found()).includes('/analytics.js'), 'no reporter stack replaces original evidence');
  assert.ok(JSON.stringify(by('bounded').$exception_list).length < 12000, 'stack payload bounded');
  assert.ok(found().every(e => e.properties.analytics_version === version));
  await page.close();
}
async function bursts(run) {
  const page = await run.pageAt(site + '/');
  const start = run.captured.length;
  await page.evaluate(() => {
    const target = document.querySelector('.hero h1');
    const click = (time, detail = 1) => {
      const event = new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10, detail });
      Object.defineProperty(event, 'timeStamp', { value: time }); target.dispatchEvent(event);
    };
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'pen' }));
    [0, 450, 900, 1050].forEach(t => click(t));
    [2200, 2400, 2600].forEach(t => click(t));
    const range = document.createRange(); range.selectNodeContents(target); getSelection().removeAllRanges(); getSelection().addRange(range);
    [4000, 4300, 4900, 5050].forEach((t, i) => click(t, i + 1));
    getSelection().removeAllRanges();
  });
  const rages = () => run.captured.slice(start).filter(e => e.event === '$rageclick');
  await until(page, () => rages().length >= 3, 'separate bursts and selected fourth click are reported');
  await page.waitForTimeout(500);
  assert.equal(rages().length, 3, 'sliding window produces only one report per burst');
  assert.deepEqual(rages().map(e => e.properties.click_count), [3, 3, 4]);
  assert.ok(rages().every(e => e.properties.pointer_type === 'pen' && e.properties.target_interactive === false && e.properties.viewport_width === 1440));
  assert.equal(rages()[2].properties.text_selected, true);
  assert.ok(rages().every(e => !('selected_text' in e.properties)));
  await page.close();
}
async function flows(run, mobile, engine) {
  const page = await run.pageAt(site + '/cloud-media-shrinker/');
  const shot = page.locator('.c-feature a.c-zoom').nth(1);
  if (mobile) {
    await shot.tap();
    await page.waitForURL(/screenshot-shrink\.webp$/);
  } else {
    await shot.click();
    await page.waitForSelector('dialog.c-viewer[open]');
    await page.evaluate(() => { window.viewerBackDone = false; addEventListener('popstate', () => { window.viewerBackDone = true; }, { once: true }); });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog.c-viewer').open);
    await page.waitForFunction(() => window.viewerBackDone);
  }
  await page.goto(site + '/cloud-media-shrinker/help/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.posthog?.__loaded);
  const question = page.locator('#iphone-background h3');
  await question.scrollIntoViewIfNeeded();
  if (!mobile) {
    const start = run.captured.length;
    await question.click({ clickCount: 3, position: { x: 100, y: 12 } });
    assert.match(await page.evaluate(() => getSelection().toString()), /Compressing stops/);
    await page.waitForTimeout(1100);
    assert.equal(run.captured.slice(start).filter(e => e.event === '$rageclick').length, 0, 'native heading selection is not frustration');
  }
  const copy = page.locator('#iphone-background .h-copy');
  const before = await page.locator('#iphone-background details').getAttribute('open');
  await (mobile ? copy.tap() : copy.click());
  assert.equal(await copy.getAttribute('data-copied'), 'Link copied');
  assert.equal(await page.evaluate(() => window.testClipboard), site + '/cloud-media-shrinker/help/#iphone-background');
  assert.equal(await page.locator('#iphone-background details').getAttribute('open'), before, 'copy keeps answer state');
  await page.goto(site + '/cloud-media-shrinker/whats-new/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.posthog?.__loaded);
  const release = page.locator('.w-where a').first();
  const destination = await release.getAttribute('href');
  await release.evaluate(a => a.removeAttribute('target'));
  await (mobile ? release.tap() : release.click());
  await page.waitForURL(destination);
  assert.ok(run.external.includes(destination), 'release activation requests its destination, intercepted locally');
  await page.goto(site + '/cloud-media-shrinker/whats-new/', { waitUntil: 'load' });
  const out = process.env.ALERT_TEST_OUTPUT;
  if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, `${engine}-${mobile ? 'touch' : 'desktop'}.png`) }); }
  assert.deepEqual(run.pageErrors, [], 'real page interactions have no uncaught errors');
  if (run.instrumentationErrors.length) console.log(`${engine}: ${run.instrumentationErrors.length} WebKit inspector Blob-on-navigation errors recorded separately; native delivery remains unverified`);
  await page.close();
}
(async () => {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    if (process.env.ALERT_TEST_BROWSER && process.env.ALERT_TEST_BROWSER !== engine) continue;
    const browser = await type.launch({ headless: true, proxy: { server: 'http://127.0.0.1:9' } });
    try {
      const run = await setup(browser);
      try {
        await errors(run); await bursts(run); await flows(run, false, engine);
        assert.ok(run.captured.every(e => e.properties.analytics_version === version), 'all SDK events carry collector release');
      } finally { await run.context.close(); }
      const touch = await setup(browser, true);
      try { await flows(touch, true, engine); } finally { await touch.context.close(); }
      const bot = await setup(browser, false, true);
      try { const page = await bot.pageAt(site + '/'); await page.waitForTimeout(2300); assert.deepEqual(bot.requests, []); } finally { await bot.context.close(); }
      const local = await setup(browser);
      try { const page = await local.pageAt('http://localhost/'); await page.waitForTimeout(2300); assert.deepEqual(local.requests, []); } finally { await local.context.close(); }
      console.log(`${engine}: original/stackless/hostile errors, origin/privacy/version, burst regression, selection, screenshots, copy links, release links, touch, bots and local silence passed`);
    } finally { await browser.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
