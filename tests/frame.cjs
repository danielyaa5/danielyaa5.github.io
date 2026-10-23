const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:4173';
const widths = [1920, 1650, 1440, 1280, 1024, 900, 768, 600, 414, 375, 320];

// Every block must stay inside the frame, and anything beside the vertical
// line under the tree must stay left of it. Full-page screenshots go to
// test-results/ for a visual pass.
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {}) });
  const report = { url: base, checks: [] };
  try {
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].filter(img => img.loading !== 'lazy').map(img => img.decode())); });
      const result = await page.evaluate(() => {
        const frame = document.querySelector('.page-frame').getBoundingClientRect();
        const hero = document.querySelector('.hero');
        const line = getComputedStyle(hero, '::after');
        const heroBox = hero.getBoundingClientRect();
        const lineShown = line.display !== 'none';
        const lineX = heroBox.right - parseFloat(line.right);
        const lineTop = heroBox.top + parseFloat(line.top);
        const lineBottom = heroBox.bottom;
        const selector = '.hero-copy, .hero-illustration, .hero-actions .button, .project, .writing-card, .writing-thumb, .site-footer, .site-header';
        const problems = [];
        for (const el of document.querySelectorAll(selector)) {
          const r = el.getBoundingClientRect();
          const name = `${el.className.split(' ')[0]}${el.querySelector('h2, h3') ? ` (${el.querySelector('h2, h3').textContent})` : ''}`;
          if (r.left < frame.left - 1 || r.right > frame.right + 1) problems.push(`${name} outside the frame`);
          if (lineShown && r.bottom > lineTop && r.top < lineBottom && r.right > lineX - 4) problems.push(`${name} touches the vertical line`);
          // Below the hero, blocks stay left of the line's column too, aligned with the header rule.
          if (lineShown && r.top >= lineBottom && r.right > lineX - 4) problems.push(`${name} extends past the vertical line's column`);
        }
        const name = document.querySelector('.identity').getBoundingClientRect();
        const nav = document.querySelector('.site-header nav').getBoundingClientRect();
        if (nav.left - name.right < 8) problems.push('navigation crowds the name');
        const rows = new Set([...document.querySelectorAll('.hero-actions .button')].map(b => Math.round(b.getBoundingClientRect().top)));
        if (rows.size > 1) problems.push('hero buttons wrap');
        return { lineShown, overflow: document.documentElement.scrollWidth > innerWidth, problems };
      });
      // Lazy images don't load in a full-page capture; load them first.
      await page.evaluate(() => Promise.all([...document.images].map(img => { img.loading = 'eager'; return img.decode(); })));
      await fs.mkdir('test-results', { recursive: true });
      await page.screenshot({ path: `test-results/frame-${width}.png`, fullPage: true });
      report.checks.push({ width, ...result });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  await fs.writeFile('test-results/frame-report.json', JSON.stringify(report, null, 2));
  for (const check of report.checks) {
    assert.equal(check.overflow, false, `Page scrolls sideways at ${check.width}px`);
    assert.deepEqual(check.problems, [], `Layout problems at ${check.width}px`);
  }
  console.log(JSON.stringify({ passed: true, widths }));
})();
