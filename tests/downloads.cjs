// Cloud Media Shrinker's download count on the home page's featured tile and on its product page.
// Run: node tests/downloads.cjs http://localhost:4173
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:4173';
const root = path.join(__dirname, '..');
const baked = html => Number((html.match(/data-cms-downloads="(\d+)"/) || [])[1]);
const pages = [
  { url: '/', html: fs.readFileSync(path.join(root, 'index.html'), 'utf8'), box: '.featured-lead', count: '.featured-lead .download-count' },
  { url: '/cloud-media-shrinker/', html: fs.readFileSync(path.join(root, 'cloud-media-shrinker/index.html'), 'utf8'), box: '.c-hero', count: '.c-hero .c-downloads' },
];
const published = JSON.parse(fs.readFileSync(path.join(root, 'cloud-media-shrinker/downloads.json'), 'utf8'));
const label = n => `${n.toLocaleString('en-US')}+`;

(async () => {
  for (const p of pages) {
    const n = baked(p.html);
    assert.ok(Number.isSafeInteger(n) && n > 0 && n % 100 === 0, `${p.url}: the baked-in count is a whole hundred`);
    assert.ok(n <= published.rounded, `${p.url}: the baked-in count is no higher than downloads.json`);
    assert.equal(p.html.match(/data-cms-downloads=/g).length, 1, `${p.url}: one count on the page`);
  }
  assert.equal(published.label, label(published.rounded), 'downloads.json label matches its number');
  assert.deepEqual(Object.keys(published).sort(), ['label', 'rounded', 'updated'], 'downloads.json holds only the rounded number');

  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const scenarios = {
      higher: { body: { rounded: 25300, label: '25,300+' }, expect: () => '25,300+' },
      lower: { body: { rounded: 100, label: '100+' }, expect: n => label(n) },
      'not-a-hundred': { body: { rounded: 25350 }, expect: n => label(n) },
      missing: { status: 404, expect: n => label(n) },
      'network-error': { abort: true, expect: n => label(n) },
      'no-javascript': { body: { rounded: 25300 }, js: false, expect: n => label(n) },
    };
    for (const p of pages) {
      for (const [name, s] of Object.entries(scenarios)) {
        const page = await browser.newPage({ javaScriptEnabled: s.js !== false });
        await page.route(/posthog|dy-relay/, route => route.abort());
        await page.route('**/cloud-media-shrinker/downloads.json', route => {
          if (s.abort) return route.abort();
          return route.fulfill({ status: s.status || 200, contentType: 'application/json', body: JSON.stringify(s.body || {}) });
        });
        await page.goto(base + p.url, { waitUntil: 'networkidle' });
        const count = page.locator(p.count);
        assert.equal(await count.count(), 1, `${p.url} ${name}: count shown once`);
        assert.equal(await count.locator('[data-downloads-number]').textContent(), s.expect(baked(p.html)), `${p.url} ${name}`);
        assert.match(await count.textContent(), /downloads/);
        for (const width of [1920, 1440, 1024, 768, 620, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          const fits = await count.evaluate((el, box) => {
            const card = el.closest(box).getBoundingClientRect(), r = el.getBoundingClientRect();
            return r.width > 0 && r.left >= card.left - 0.5 && r.right <= card.right + 0.5 && document.documentElement.scrollWidth <= innerWidth;
          }, p.box);
          assert.ok(fits, `${p.url} ${name}: the count fits at ${width}px with no sideways scroll`);
        }
        await page.close();
      }
    }
    // On a phone the product page's count sits right under the download buttons.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route(/posthog|dy-relay/, route => route.abort());
    await page.goto(base + '/cloud-media-shrinker/', { waitUntil: 'networkidle' });
    const [actions, line] = await Promise.all(['.c-hero .c-actions', '.c-hero .c-downloads'].map(sel => page.locator(sel).boundingBox()));
    assert.ok(line.y >= actions.y + actions.height && line.y - (actions.y + actions.height) < 40, 'count follows the buttons on a phone');
    await page.close();
    console.log('downloads: ok');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
