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
const tracked = ['index.html', 'blog/index.html', 'quickdesk/index.html', 'resume/index.html', 'motorcycle-rentals/index.html',
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
      // The web vitals script sits beside array.js in PostHog's package (dist/web-vitals*.js).
      await context.route(/^https:\/\/us-assets\.i\.posthog\.com\/static\/(?:[\d.]+\/)?(web-vitals[\w-]*)\.js/, route => {
        const name = route.request().url().match(/(web-vitals[\w-]*)\.js/)[1];
        route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(path.dirname(process.env.POSTHOG_ARRAY_JS), `${name}.js`)) });
      });
    }
    await context.route(/^https:\/\/us(-assets)?\.i\.posthog\.com\/(?!static\/(?:[\d.]+\/)?(?:array|web-vitals[\w-]*)\.js)/, async route => {
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

    // Page speed: a click gives an interaction, and hiding the page sends the web vitals gathered so far,
    // with this site's addresses cleaned inside each metric too.
    await page.locator('.hero h1').click();
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(1500);
    const vitals = captured.filter(e => e.event === '$web_vitals');
    assert.ok(vitals.length >= 1, 'web vitals are sent');
    const metrics = Object.assign({}, ...vitals.map(e => e.properties));
    for (const name of ['FCP', 'LCP']) {
      assert.equal(typeof metrics[`$web_vitals_${name}_value`], 'number', `${name} is measured`);
      assert.equal(metrics[`$web_vitals_${name}_event`].$current_url, `${site}/`, `${name} address is cleaned`);
    }
    assert.ok(vitals.every(e => e.properties.$current_url === `${site}/` && e.properties.$cookieless_mode === true), 'cookieless web vitals with a clean address');
    assert.ok(!/utm_source=|private-fragment/.test(JSON.stringify(vitals)), 'no query or fragment inside web vitals');

    // Links in project tiles send a project_click named after the project, at phone, tablet and desktop widths.
    // Navigation is cancelled after the site's own listeners run, so the page stays put.
    context.on('page', async popup => { if (await popup.opener()) await popup.close().catch(() => {}); });
    for (const width of [390, 820, 1440]) {
      const tiles = await context.newPage();
      await tiles.setViewportSize({ width, height: 900 });
      await tiles.goto(`${site}/`, { waitUntil: 'networkidle' });
      await tiles.waitForFunction(() => window.posthog?.__loaded === true);
      await tiles.evaluate(() => {
        for (const type of ['click', 'auxclick']) window.addEventListener(type, event => { if (event.target.closest?.('a[href]')) event.preventDefault(); });
      });
      const start = captured.length;
      await tiles.locator('.featured-lead .featured-link').click();
      await tiles.locator('.featured-pick').nth(1).locator('.project-name').click({ button: 'middle' });
      await tiles.locator('[data-filter="web"]').click();
      await tiles.locator('#project-list .project', { hasText: 'Netflix PiP Fixer' }).locator('.project-link').click();
      await tiles.locator('.hero-actions a', { hasText: 'GitHub' }).click();
      await tiles.waitForTimeout(1500);
      const clicks = captured.slice(start).filter(e => e.event === 'project_click').map(e => e.properties);
      const pick = ({ project, link, link_text, destination, section, position, filter }) => ({ project, link, link_text, destination, section, position, filter });
      assert.deepEqual(clicks.map(pick), [
        { project: 'Cloud Media Shrinker', link: 'button', link_text: 'View on the Mac App Store →', destination: 'https://apps.apple.com/app/cloud-media-shrinker/id6824383256', section: 'featured', position: 1, filter: undefined },
        { project: 'puml-for-markdown', link: 'title', link_text: 'puml-for-markdown', destination: 'https://github.com/danielyaa5/puml-for-markdown', section: 'featured', position: 2, filter: undefined },
        { project: 'Netflix PiP Fixer', link: 'button', link_text: 'Get it on the Chrome Web Store →', destination: 'https://chromewebstore.google.com/detail/netflix-pip-fixer/ceiiadpnmbplofcefdafhfidmocjgikp', section: 'other', position: 4, filter: 'web' },
      ], `project clicks at ${width}px; links outside the tiles send none`);
      assert.ok(clicks.every(props => props.$cookieless_mode === true && props.$current_url === `${site}/`), `cookieless project clicks at ${width}px`);
      await tiles.close();
    }

    // Booking links on the motorcycle rentals page send a rental_click named after the bike and the site.
    for (const width of [390, 820, 1440]) {
      const rentals = await context.newPage();
      await rentals.setViewportSize({ width, height: 900 });
      await rentals.goto(`${site}/motorcycle-rentals/`, { waitUntil: 'networkidle' });
      await rentals.waitForFunction(() => window.posthog?.__loaded === true);
      await rentals.evaluate(() => {
        for (const type of ['click', 'auxclick']) window.addEventListener(type, event => { if (event.target.closest?.('a[href]')) event.preventDefault(); });
      });
      const expected = await rentals.locator('.rentals a[data-platform]').evaluateAll(links => links.map(a => {
        const bike = a.closest('.bike');
        return { bike: bike ? bike.querySelector('h3').textContent.trim() : 'All bikes', platform: a.dataset.platform, link_text: a.textContent.replace(/\s+/g, ' ').trim(), destination: a.href, position: bike ? [...document.querySelectorAll('.bike')].indexOf(bike) + 1 : 0 };
      }));
      assert.ok(expected.filter(e => e.position > 0).length >= 2, 'the rentals page has booking links');
      const start = captured.length;
      const links = rentals.locator('.rentals a[data-platform]');
      for (let i = 0; i < expected.length; i++) await links.nth(i).click({ button: i % 2 ? 'middle' : 'left' });
      await rentals.locator('.site-header nav a', { hasText: 'Work' }).click();
      await rentals.waitForTimeout(1500);
      const sent = captured.slice(start).filter(e => e.event === 'rental_click').map(e => e.properties);
      const pick = ({ bike, platform, link_text, destination, position }) => ({ bike, platform, link_text, destination, position });
      assert.deepEqual(sent.map(pick), expected, `rental clicks at ${width}px; other links send none`);
      assert.ok(sent.every(props => props.$cookieless_mode === true && props.$current_url === `${site}/motorcycle-rentals/`), `cookieless rental clicks at ${width}px`);
      await rentals.close();
    }

    // Email sign-ups send email_signup with the ticked topics, and a failed one sends email_signup_failed.
    // The address itself never reaches PostHog. The sign-up function is faked here.
    for (const width of [390, 820, 1440]) {
      const form = await context.newPage();
      await form.setViewportSize({ width, height: 900 });
      let reply = { ok: true };
      await form.route('https://danielyakobian.com/api/subscribe/', route => route.fulfill({ status: reply.ok ? 200 : 502, contentType: 'application/json', headers: { 'access-control-allow-origin': site }, body: JSON.stringify(reply) }));
      await form.goto(`${site}/`, { waitUntil: 'networkidle' });
      await form.waitForFunction(() => window.posthog?.__loaded === true);
      const start = captured.length;
      await form.getByLabel(/Beta tester invites/).check();
      await form.getByLabel(/Promos/).check();
      await form.locator('.signup-email').fill('private-reader@example.com');
      await form.locator('.signup-button').click();
      await form.waitForSelector('.signup.is-done');
      await form.locator('.signup-edit').click();
      reply = { ok: false, error: 'provider_error' };
      await form.locator('.signup-email').fill('private-reader@example.com');
      await form.locator('.signup-button').click();
      await form.waitForFunction(() => document.querySelector('.signup-status').dataset.kind === 'error');
      await form.waitForTimeout(1500);
      const sent = captured.slice(start);
      const signups = sent.filter(e => /^email_signup/.test(e.event)).map(({ event, properties: p }) => ({ event, topics: p.topics, topic_count: p.topic_count, new_apps: p.new_apps, beta: p.beta, promos: p.promos, error: p.error }));
      assert.deepEqual(signups, [
        { event: 'email_signup', topics: ['beta', 'promos'], topic_count: 2, new_apps: false, beta: true, promos: true, error: undefined },
        { event: 'email_signup_failed', topics: ['beta', 'promos'], topic_count: 2, new_apps: false, beta: true, promos: true, error: 'provider_error' },
      ], `sign-up events at ${width}px`);
      assert.ok(!JSON.stringify(sent).includes('private-reader'), `the email address is never sent to PostHog at ${width}px`);
      await form.close();
    }

    // The guest gate page never loads analytics.
    const before = captured.length;
    const gateRequests = [];
    const gate = await context.newPage();
    gate.on('request', r => gateRequests.push(r.url()));
    await gate.goto(`${site}/gate/`, { waitUntil: 'networkidle' });
    assert.ok(!gateRequests.some(url => /analytics\.js|posthog/.test(url)), 'gate page loads no analytics');
    assert.equal(captured.length, before, 'gate page sends nothing');
    console.log(`Analytics checks passed: ${tracked.length} tracked pages, ${untracked.length} untracked, cookieless page view without query or fragment, web vitals, project clicks, rental clicks and sign-up events at 3 widths.`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
