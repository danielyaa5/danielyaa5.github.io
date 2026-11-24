// Phones: the Cloud Media Shrinker pages show no floating site dock (Work, Blog, Resume, Shop, Rentals) and leave no
// gap where it was; every other page keeps it, and desktop keeps the header nav everywhere.
// Run: node tests/cms-dock.cjs http://localhost:4173   (PLAYWRIGHT_BROWSER=webkit for Safari's engine)
const assert = require('node:assert/strict');
const playwright = require('playwright');
const base = process.argv[2] || 'http://localhost:4173';
const engine = playwright[process.env.PLAYWRIGHT_BROWSER || 'chromium'];
const cmsPages = ['/cloud-media-shrinker/', '/cloud-media-shrinker/help/', '/cloud-media-shrinker/whats-new/', '/cloud-media-shrinker/whats-coming/', '/cloud-media-shrinker/privacy/'];
const dockPages = ['/', '/blog/', '/3d-print-monitor/'];

(async () => {
  const browser = await engine.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const look = async (url, width) => {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await page.route(/posthog|dy-relay/, route => route.abort());
      await page.goto(base + url, { waitUntil: 'load' });
      const state = await page.evaluate(() => {
        const nav = document.querySelector('.site-header nav');
        const box = nav.getBoundingClientRect();
        const style = getComputedStyle(nav);
        const frame = document.querySelector('.page-frame').getBoundingClientRect();
        return {
          shown: style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0,
          fixed: style.position === 'fixed',
          bodyPad: parseFloat(getComputedStyle(document.body).paddingBottom),
          // Space below the page frame at the very bottom of the page.
          below: document.documentElement.scrollHeight - (frame.bottom + scrollY),
          cmsNav: !!document.querySelector('nav.cms-nav') && document.querySelector('nav.cms-nav').getBoundingClientRect().height > 0,
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      await page.close();
      return state;
    };
    for (const width of [390, 320]) {
      for (const url of cmsPages) {
        const s = await look(url, width);
        assert.equal(s.shown, false, `${url} at ${width}px: no floating dock`);
        assert.equal(s.bodyPad, 0, `${url} at ${width}px: no space kept for the dock`);
        assert.ok(s.below <= 16, `${url} at ${width}px: no blank strip at the bottom (${s.below}px)`);
        assert.ok(s.cmsNav, `${url} at ${width}px: the app's own nav is still there`);
        assert.ok(s.overflow <= 0, `${url} at ${width}px: no sideways scroll`);
      }
      for (const url of dockPages) {
        const s = await look(url, width);
        assert.ok(s.shown && s.fixed, `${url} at ${width}px: the floating dock is still shown`);
        assert.ok(s.bodyPad > 80, `${url} at ${width}px: room is kept for the dock`);
      }
    }
    for (const url of [cmsPages[0], '/']) {
      const s = await look(url, 1440);
      assert.ok(s.shown && !s.fixed, `${url} at 1440px: the header nav is shown in the header`);
    }
    console.log(`cms-dock: ok (${process.env.PLAYWRIGHT_BROWSER || 'chromium'})`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
