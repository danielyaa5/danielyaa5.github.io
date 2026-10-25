const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:4173';
const repoAPI = 'https://api.github.com/repos/danielyaa5/puml-for-markdown';

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const scenario of ['live-count', 'rate-limited', 'network-error', 'invalid-count', 'no-javascript']) {
      const page = await browser.newPage({ javaScriptEnabled: scenario !== 'no-javascript' });
      await page.route(repoAPI, route => {
        if (scenario === 'network-error') return route.abort();
        return route.fulfill({
          status: scenario === 'rate-limited' ? 403 : 200,
          contentType: 'application/json',
          body: JSON.stringify({ stargazers_count: scenario === 'invalid-count' ? null : 1234 })
        });
      });
      await page.goto(base, { waitUntil: 'networkidle' });
      const badges = page.locator('[data-github-stars="danielyaa5/puml-for-markdown"]');
      assert.equal(await badges.count(), 1, 'PUML appears once, in the featured section');
      const expected = scenario === 'live-count' ? '1,234' : '343';
      assert.deepEqual(await badges.locator('[data-star-number]').allTextContents(), [expected]);
      for (const badge of await badges.all()) {
        assert.equal(await badge.getAttribute('aria-label'), `${expected} GitHub stars`);
        assert.ok(await badge.isVisible());
      }
      const featured = page.locator('.featured-pick').filter({ has: page.locator('[data-github-stars]') });
      assert.equal(await featured.locator('a a').count(), 0, 'The badge must not nest links');
      assert.equal(await badges.getAttribute('href'), 'https://github.com/danielyaa5/puml-for-markdown/stargazers');
      for (const width of [1920, 1440, 768, 620, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(await featured.locator('.star-count').evaluate(badge => {
          const card = badge.closest('.featured-pick').getBoundingClientRect();
          const rect = badge.getBoundingClientRect();
          return rect.width > 0 && rect.left >= card.left && rect.right <= card.right && rect.top >= card.top && rect.bottom <= card.bottom;
        }), `Featured stars fit at ${width}px (${scenario})`);
      }
      await page.close();
    }
    console.log('Star badges passed: live updates, API failures, invalid data, no JavaScript, and responsive fit.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
