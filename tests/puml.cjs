const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

// Run: node tests/puml.cjs http://localhost:4173
// The puml-for-markdown page: search basics and structured data, the home page's card pointing here,
// live GitHub and npm counts that fall back to the dated ones, the diagram viewer opening linked diagrams
// in place (trail, Back, actual size), the demo's play button, and a layout that fits from 1440px to 320px.
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const site = 'https://danielyakobian.com';
const page = `${site}/puml-for-markdown/`;
const repo = 'https://github.com/danielyaa5/puml-for-markdown';
const npm = 'https://www.npmjs.com/package/puml-for-markdown';
const root = path.join(__dirname, '..');
const diagrams = path.join(root, 'assets/puml-for-markdown/diagrams');
const jsonLd = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

(async () => {
  const get = async url => {
    const response = await fetch(base + url);
    assert.equal(response.status, 200, `${url} returned ${response.status}`);
    return response.text();
  };
  const html = await get('/puml-for-markdown/');
  assert.ok(html.includes(`<link rel="canonical" href="${page}">`), 'canonical');
  assert.ok((await get('/sitemap.xml')).includes(`<loc>${page}</loc>`), 'page is in sitemap.xml');
  const analytics = (await get('/')).match(/<script src="(\/analytics\.js\?v=[^"]+)" defer><\/script>/)[1];
  assert.ok(html.includes(`<script src="${analytics}" defer></script>`), `loads the same analytics script as the home page (${analytics})`);
  const description = html.match(/<meta name="description" content="([^"]+)">/)[1];
  assert.ok(description.length >= 70 && description.length <= 160, `meta description is ${description.length} characters`);
  assert.doesNotMatch(html, /—/, 'no em dashes in the copy');
  const app = jsonLd(html).find(node => node['@type'] === 'SoftwareApplication');
  assert.equal(app.url, page);
  assert.equal(app.isAccessibleForFree, true);
  assert.ok(app.sameAs.includes(repo) && app.sameAs.includes(npm), 'structured data links GitHub and npm');

  // The home page's featured card and its structured data point here, and still name GitHub and npm.
  const home = await get('/');
  assert.ok(home.includes(`<a class="project-name" href="${page}">puml-for-markdown</a>`), 'featured card title links here');
  assert.ok(home.includes(`<a class="featured-link" href="${page}">`), 'featured card button links here');
  const listed = jsonLd(home)[0]['@graph'].find(node => node['@type'] === 'ItemList').itemListElement.map(entry => entry.item).find(item => item.name === 'puml-for-markdown');
  assert.equal(listed.url, page);
  assert.deepEqual(listed.sameAs, [repo, npm]);

  // Every link inside an exported diagram that points at another diagram points at one that's here.
  for (const file of fs.readdirSync(diagrams)) {
    for (const [, target] of fs.readFileSync(path.join(diagrams, file), 'utf8').matchAll(/ href="([^"]+\.svg)"/g)) {
      assert.ok(fs.existsSync(path.join(diagrams, target)), `${file} links to ${target}, which exists`);
    }
  }

  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    // Live counts replace the dated ones only when both services answer.
    for (const scenario of ['live', 'down']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const tab = await context.newPage();
      await tab.route('https://api.github.com/**', route => (scenario === 'down' ? route.abort() : route.fulfill({ contentType: 'application/json', body: JSON.stringify({ stargazers_count: 1234, forks_count: 56 }) })));
      await tab.route('https://api.npmjs.org/**', route => (scenario === 'down' ? route.abort() : route.fulfill({ contentType: 'application/json', body: JSON.stringify({ downloads: 7890 }) })));
      await tab.goto(`${base}/puml-for-markdown/`, { waitUntil: 'networkidle' });
      const stats = await tab.locator('[data-stat]').allTextContents();
      const note = await tab.locator('[data-stats-note]').textContent();
      if (scenario === 'live') {
        assert.deepEqual(stats, ['1,234', '56', '7,890']);
        assert.equal(note, 'Live from GitHub and npm.');
      } else {
        assert.ok(stats.every(count => /^\d[\d,]*$/.test(count)), 'dated counts stay when the services fail');
        assert.match(note, /^Counts from [A-Z][a-z]+ \d{1,2}, \d{4}\.$/, 'dated counts say when they were checked');
      }
      await context.close();
    }

    // The viewer: a yellow block opens the diagram it links to, the trail and Back go up again.
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const tab = await context.newPage();
    const failed = [];
    tab.on('response', response => response.url().startsWith(base) && response.status() >= 400 && failed.push(`${response.status()} ${response.url()}`));
    tab.on('pageerror', error => failed.push(String(error)));
    await tab.route(/api\.(github|npmjs)\.(com|org)/, route => route.abort());
    await tab.goto(`${base}/puml-for-markdown/`, { waitUntil: 'networkidle' });
    const viewer = tab.locator('[data-viewer]');
    await viewer.scrollIntoViewIfNeeded();
    await tab.waitForSelector('[data-viewer-canvas] > svg');
    const trail = () => viewer.locator('[data-viewer-trail] li').allTextContents();
    assert.deepEqual(await trail(), ['System view']);
    assert.equal(await viewer.locator('[data-viewer-back]').isDisabled(), true);
    await viewer.locator('[data-viewer-canvas] svg a[href="level_2_container_view.svg"]').click();
    await tab.waitForFunction(() => document.querySelector('[data-viewer-canvas] svg')?.getAttribute('aria-label') === 'Container view diagram');
    assert.deepEqual(await trail(), ['System view', 'Container view']);
    assert.equal(tab.url(), `${base}/puml-for-markdown/`, 'the page stays put');
    assert.match(await viewer.locator('[data-viewer-open]').getAttribute('href'), /level_2_container_view\.svg$/);
    await viewer.locator('[data-viewer-canvas] svg a[href="level_3_component_view_pipeline.svg"]').click();
    await tab.waitForFunction(() => document.querySelectorAll('[data-viewer-trail] li').length === 3);
    assert.deepEqual(await trail(), ['System view', 'Container view', 'Pipeline component']);
    assert.equal(await viewer.locator('[data-viewer-hint]').isVisible(), true, 'a wide diagram says it scrolls');
    await viewer.locator('[data-viewer-back]').click();
    await tab.waitForFunction(() => document.querySelectorAll('[data-viewer-trail] li').length === 2);
    await viewer.locator('[data-viewer-trail] button', { hasText: 'System view' }).click();
    await tab.waitForFunction(() => document.querySelectorAll('[data-viewer-trail] li').length === 1);
    assert.equal(await viewer.locator('[data-viewer-back]').isDisabled(), true);
    // Actual size shows the diagram at its exported width.
    await viewer.locator('[data-viewer-zoom]').click();
    assert.equal(await viewer.locator('[data-viewer-zoom]').getAttribute('aria-pressed'), 'true');
    assert.equal(await tab.locator('[data-viewer-canvas] > svg').evaluate(svg => svg.getBoundingClientRect().width), 666);
    // The demo's button says what it will do.
    const toggle = tab.locator('[data-video-toggle]');
    assert.ok(await toggle.isVisible(), 'the demo has a play/pause button');
    assert.equal(await toggle.textContent(), await tab.locator('[data-demo-video]').evaluate(video => (video.paused ? 'Play' : 'Pause')));
    assert.deepEqual(failed, [], 'no failed requests or script errors');
    await context.close();

    // Visitors who prefer reduced motion get the still frame until they press Play.
    const calm = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const calmTab = await calm.newPage();
    await calmTab.goto(`${base}/puml-for-markdown/`, { waitUntil: 'networkidle' });
    assert.equal(await calmTab.locator('[data-demo-video]').evaluate(video => video.paused), true);
    assert.equal(await calmTab.locator('[data-video-toggle]').textContent(), 'Play');
    await calm.close();

    // No sideways scroll, in light and dark mode.
    for (const colorScheme of ['light', 'dark']) {
      const layout = await browser.newContext({ colorScheme });
      const layoutTab = await layout.newPage();
      for (const width of [1440, 1024, 768, 375, 320]) {
        await layoutTab.setViewportSize({ width, height: 900 });
        await layoutTab.goto(`${base}/puml-for-markdown/`, { waitUntil: 'networkidle' });
        assert.equal(await layoutTab.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `no sideways scroll at ${width}px (${colorScheme})`);
      }
      await layout.close();
    }
  } finally {
    await browser.close();
  }
  console.log('puml-for-markdown page passed: search basics, home card, live and dated counts, diagram viewer, demo button, layout 1440-320px light and dark.');
})().catch(error => { console.error(error); process.exitCode = 1; });
