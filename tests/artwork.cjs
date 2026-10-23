const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://127.0.0.1:4173';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const report = { url: base, density: 2, checks: [] };
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(base, { waitUntil: 'networkidle' });
      const result = await page.evaluate(() => {
        const art = [...document.querySelectorAll('.hero-illustration, .project-illustration')];
        const links = [...document.querySelectorAll('.project-link, .profile-link')];
        return {
          fits: document.documentElement.scrollWidth <= innerWidth,
          images: art.map(image => ({
            source: image.getAttribute('src'),
            loaded: image.complete && image.naturalWidth > 0,
            pixels: image.naturalWidth,
            requiredPixels: Math.ceil(image.getBoundingClientRect().width * devicePixelRatio)
          })),
          links: links.map(link => {
            const icon = link.querySelector('.link-icon');
            const iconRect = icon.getBoundingClientRect();
            const textRect = link.querySelector('span').getBoundingClientRect();
            return {
              vector: icon.getAttribute('src').endsWith('.svg'),
              loaded: icon.complete && icon.naturalWidth > 0,
              centerDelta: Math.abs(iconRect.top + iconRect.height / 2 - textRect.top - textRect.height / 2),
              gap: textRect.left - iconRect.right
            };
          })
        };
      });
      assert.ok(result.fits, `No horizontal overflow at ${width}px`);
      assert.equal(result.images.length, 11);
      for (const image of result.images) {
        assert.ok(image.loaded, `Artwork loads: ${image.source}`);
        assert.ok(image.pixels >= image.requiredPixels, `Artwork supports 2x displays: ${image.source}`);
      }
      assert.equal(result.links.length, 12);
      assert.ok(result.links.every(link => link.vector && link.loaded && link.centerDelta < 0.5 && link.gap >= 5), `Chain icons are crisp, centered, and spaced at ${width}px`);
      await fs.mkdir('test-results', { recursive: true });
      await page.screenshot({ path: `test-results/artwork-${width}.png`, fullPage: true });
      report.checks.push({ width, ...result });
    }
    const icon = await page.locator('link[rel="icon"]').getAttribute('href');
    assert.equal((await page.request.get(new URL(icon, base).href)).status(), 200);
    assert.deepEqual(failures, []);
    report.passed = true;
    await fs.writeFile('test-results/artwork-report.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, widths: report.checks.map(check => check.width), density: 2 }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
