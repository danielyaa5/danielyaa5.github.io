const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

// Run: node tests/nav.cjs http://localhost:4173
// Every page with the site header must show the home page's navigation and corner mark, so a new
// nav link can't be added to some pages and forgotten on others (the blog once kept an older nav).
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '') + '/';
const blogPages = fs.readdirSync(path.join(__dirname, '..', 'blog')).filter(f => f.endsWith('.html')).map(f => 'blog/' + (f === 'index.html' ? '' : f));
const pages = [['', null], ['resume/', 'Resume'], ['motorcycle-rentals/', 'Motorcycle Rentals'], ...blogPages.map(p => [p, 'Blog'])];

(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
  const failures = [];
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    const read = () => page.evaluate(() => {
      const nav = document.querySelector('.site-header nav[aria-label="Main navigation"]');
      const mark = document.querySelector('.site-header + .site-mark');
      return {
        links: nav ? [...nav.querySelectorAll('a')].map(a => [a.getAttribute('aria-label') || a.textContent.trim(), a.href, a.dataset.icon]) : [],
        current: nav ? [...nav.querySelectorAll('[aria-current="page"]')].map(a => a.getAttribute('aria-label') || a.textContent.trim()) : [],
        mark: mark ? mark.outerHTML : null,
        markClear: mark && nav ? [...nav.querySelectorAll('a')].every(a => a.getBoundingClientRect().right <= mark.getBoundingClientRect().left) : false,
      };
    });
    await page.goto(base, {waitUntil:'domcontentloaded'});
    const home = await read();
    assert.deepEqual(home.links.map(l => l[0]), ['Work','Blog','Resume','3D Print Shop','Motorcycle Rentals']);
    for (const [url, current] of pages) {
      try {
        await page.goto(base + url, {waitUntil:'domcontentloaded'});
        const got = await read();
        assert.deepEqual(got.links, home.links, 'same navigation links as the home page');
        assert.deepEqual(got.current, current ? [current] : [], 'current page marked in the navigation');
        assert.equal(got.mark, home.mark, 'same corner mark as the home page');
        assert.ok(got.markClear, 'navigation stays left of the corner mark at 1440px');
        console.log(`ok  /${url}`);
      } catch (error) {
        failures.push(`/${url}: ${error.message.split('\n')[0]}`);
        console.log(`FAIL /${url}: ${error.message}`);
      }
    }
  } finally { await browser.close(); }
  if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
})();
