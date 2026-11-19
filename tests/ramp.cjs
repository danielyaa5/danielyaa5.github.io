const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');

// Run: node tests/ramp.cjs http://localhost:4173
// The robot vacuum ramp guide: its structured data must match what the page shows (prices, questions),
// both order buttons go to the Etsy listing, the size finder applies the listing's ranges at their edges,
// the layout fits from 1440px down to 320px in light and dark mode, and the ramp stays off the home
// page's project tiles (3D prints live in the 3D Print Shop, not the projects grid).
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const site = 'https://danielyakobian.com';
const url = `${base}/robot-vacuum-ramp/`;
const listing = 'https://www.etsy.com/listing/4619872869/custom-robot-vacuum-threshold-ramp-made';
const jsonLd = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
const text = html => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ').trim();

(async () => {
  const get = async path => {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, `${path} returned ${response.status}`);
    return response.text();
  };
  const html = await get('/robot-vacuum-ramp/');
  assert.match(html, /<link rel="canonical" href="https:\/\/danielyakobian\.com\/robot-vacuum-ramp\/">/);
  assert.ok((await get('/sitemap.xml')).includes(`<loc>${site}/robot-vacuum-ramp/</loc>`), 'page is in sitemap.xml');
  const description = html.match(/<meta name="description" content="([^"]+)">/)[1];
  assert.ok(description.length >= 70 && description.length <= 170, `meta description is ${description.length} characters`);

  // Structured data: a Product with real prices only (no ratings or reviews), and an FAQ that matches the page.
  const data = jsonLd(html);
  assert.doesNotMatch(JSON.stringify(data), /aggregateRating|"review/i, 'no ratings or reviews in structured data');
  const product = data.find(node => node['@type'] === 'Product');
  const prices = [...html.matchAll(/<td>\$(\d+\.\d\d)<\/td>/g)].map(m => Number(m[1]));
  assert.equal(prices.length, 8, 'eight size options in the price table');
  assert.equal(Number(product.offers.lowPrice), Math.min(...prices));
  assert.equal(Number(product.offers.highPrice), Math.max(...prices));
  assert.equal(product.offers.offerCount, prices.length);
  assert.equal(product.offers.priceCurrency, 'USD');
  assert.equal(product.offers.url, listing);
  assert.equal(product.offers.availability, 'https://schema.org/MadeToOrder');
  assert.ok(html.includes(`From $${Math.min(...prices).toFixed(2)}`), 'the hero shows the lowest price');
  const faq = data.find(node => node['@type'] === 'FAQPage').mainEntity;
  const faqHtml = html.match(/<div class="faq">([\s\S]*?)<\/div>/)[1];
  const shown = [...faqHtml.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map(m => [text(m[1]), text(m[2])]);
  assert.deepEqual(faq.map(q => [q.name, q.acceptedAnswer.text]), shown, 'FAQ structured data matches the questions on the page');

  // The home page keeps 3D prints out of the project tiles and their structured data.
  const home = await get('/');
  const items = jsonLd(home)[0]['@graph'].find(node => node['@type'] === 'ItemList').itemListElement;
  assert.ok(items.every(entry => !/ramp/i.test(entry.item.name) && !/robot-vacuum-ramp|etsy\.com/.test(entry.item.url)), 'no ramp in the project ItemList');
  const tiles = [...home.matchAll(/<article class="project[\s\S]*?<\/article>|<article class="featured-pick[\s\S]*?<\/article>/g)].map(m => m[0]);
  assert.ok(tiles.length > 0);
  assert.ok(tiles.every(tile => !/ramp/i.test(tile)), 'no ramp tile on the home page');
  // The guide's internal links come from the 3D printing posts, not the home page.
  for (const post of ['k1-max-chamber-heater', 'h2d-exhaust-fan', 'bambu-headless-cli']) {
    assert.ok((await get(`/blog/${post}.html`)).includes('<a href="../robot-vacuum-ramp/">'), `blog/${post}.html links to the ramp guide`);
  }

  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const errors = [];
  try {
    for (const [width, scheme] of [[1440, 'light'], [1024, 'light'], [768, 'light'], [390, 'light'], [390, 'dark'], [320, 'light']]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
      page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.evaluate(() => Promise.all([...document.images].map(img => { img.loading = 'eager'; return img.decode(); })));
      const result = await page.evaluate(() => {
        const frame = document.querySelector('.page-frame').getBoundingClientRect();
        const problems = [];
        for (const el of document.querySelectorAll('.ramp-hero, .ramp-hero-copy, .ramp-hero-media, .ramp-guide > *, .edge-card, .site-footer, .site-header')) {
          const r = el.getBoundingClientRect();
          if (r.left < frame.left - 1 || r.right > frame.right + 1) problems.push(`${el.className || el.tagName} outside the frame`);
        }
        const hero = document.querySelector('.ramp-hero-media img');
        const buttons = [...document.querySelectorAll('.ramp-hero .ramp-actions .button')];
        const diagrams = [...document.querySelectorAll('.ramp-diagram svg, .edge-card svg')].map(svg => svg.getBoundingClientRect());
        const labels = [...document.querySelectorAll('.ramp-diagram .d-label, .ramp-diagram .d-note, .ramp-diagram .d-text')].map(t => t.getBoundingClientRect().height);
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          problems,
          heroLoaded: hero.complete && hero.naturalWidth > 0,
          heroSharp: hero.naturalWidth >= Math.ceil(hero.getBoundingClientRect().width * devicePixelRatio),
          heroButtonRows: new Set(buttons.map(b => Math.round(b.getBoundingClientRect().top))).size,
          diagrams: diagrams.length,
          diagramsShown: diagrams.every(r => r.width > 100 && r.height > 50),
          smallestLabel: Math.min(...labels),
          finderShown: !document.getElementById('size-finder').hidden,
          copyShown: !document.querySelector('.copy-button').hidden
        };
      });
      const where = `${width}px ${scheme}`;
      assert.equal(result.overflow, false, `page scrolls sideways at ${where}`);
      assert.deepEqual(result.problems, [], `layout problems at ${where}`);
      assert.ok(result.heroLoaded && result.heroSharp, `hero image loads and is sharp at 2x at ${where}`);
      assert.equal(result.heroButtonRows, 1, `hero buttons stay on one row at ${where}`);
      assert.equal(result.diagrams, 5);
      assert.ok(result.diagramsShown, `diagrams render at ${where}`);
      // Diagram labels scale with the column; keep them readable on phones.
      assert.ok(result.smallestLabel >= 9, `diagram labels are at least 9px tall at ${where} (smallest ${result.smallestLabel.toFixed(1)}px)`);
      assert.ok(result.finderShown, `size finder shown at ${where}`);
      await fs.mkdir('test-results', { recursive: true });
      await page.screenshot({ path: `test-results/ramp-${width}-${scheme}.png`, fullPage: true });
      await page.close();
    }

    // The size finder follows the listing's ranges, including the edges, in inches and millimeters.
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`finder: ${error.message}`));
    await page.goto(url, { waitUntil: 'networkidle' });
    const finder = page.locator('#size-finder');
    const output = finder.locator('output');
    const check = async (unit, height, width, expected) => {
      await finder.locator(`input[name="unit"][value="${unit}"]`).check({ force: true });
      await finder.locator('input[name="height"]').fill(String(height));
      await finder.locator('input[name="width"]').fill(String(width));
      // The first line is the size option (or why it's outside the sizes); a second line adds the reach or a note.
      const got = (await output.locator(':scope > :first-child').textContent()).trim();
      if (expected instanceof RegExp) assert.match(got, expected, `${height} x ${width} ${unit}`);
      else assert.equal(got, expected, `${height} x ${width} ${unit}`);
    };
    await check('in', 0.6, 30, 'Up to 0.6 in, up to 32 in wide: $39.99 for one side.');
    await check('in', 0.61, 30, 'Over 0.6 to 0.9 in, up to 32 in wide: $49.99 for one side.');
    await check('in', 0.9, 32, 'Over 0.6 to 0.9 in, up to 32 in wide: $49.99 for one side.');
    assert.equal(await output.locator('.finder-reach').textContent(), 'It would reach roughly 3.1 in (78 mm) into the room.');
    await check('in', 0.9, 32.01, 'Over 0.6 to 0.9 in, over 32 to 48 in wide: $64.99 for one side.');
    await check('in', 1.2, 36, 'Over 0.9 to 1.2 in, over 32 to 48 in wide: $79.99 for one side.');
    await check('in', 1.6, 48, 'Over 1.2 to 1.6 in, over 32 to 48 in wide: $94.99 for one side.');
    await check('in', 1.61, 30, /^That's taller than the listed sizes, which stop at 1\.6 in \(40\.64 mm\)\.$/);
    assert.equal(await output.locator('.finder-reach').textContent(), "Send me your measurements anyway, and I'll let you know if I can make one.");
    await check('in', 1, 48.5, /^That's wider than the listed sizes, which stop at 48 in \(1219\.2 mm\)\.$/);
    await check('in', 2, 50, /taller .* and wider/);
    await check('mm', 15.24, 812.8, 'Up to 0.6 in, up to 32 in wide: $39.99 for one side.');
    await check('mm', 22.86, 812.8, 'Over 0.6 to 0.9 in, up to 32 in wide: $49.99 for one side.');
    await check('mm', 22.87, 812.9, 'Over 0.9 to 1.2 in, over 32 to 48 in wide: $79.99 for one side.');
    await check('mm', 40.64, 1219.2, 'Over 1.2 to 1.6 in, over 32 to 48 in wide: $94.99 for one side.');
    // Reach into the room from the 16 degree climb and 0.6 mm leading edge: (height - 0.6 mm) / tan(16).
    assert.equal(await output.locator('.finder-reach').textContent(), 'It would reach roughly 140 mm (5.5 in) into the room.');
    await check('mm', 40.65, 900, /taller than the listed sizes/);
    assert.equal(await finder.locator('[data-unit-label]').first().textContent(), 'mm');
    await finder.locator('input[name="height"]').fill('');
    assert.match(await output.textContent(), /^Enter your threshold height/);

    // Both order buttons go to the listing, and the message template copies as shown.
    const ctas = await page.locator('a[data-ramp-cta]').evaluateAll(links => links.map(a => a.href));
    assert.deepEqual(ctas, [listing, listing]);
    await page.locator('.copy-button').click();
    await page.waitForFunction(() => document.querySelector('.copy-status').textContent.startsWith('Copied'));
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(copied, (await page.locator('#ramp-message').textContent()).trim());
    assert.match(copied, /^Hi! Here are my measurements/);
    await context.close();
  } finally {
    await browser.close();
  }
  assert.deepEqual(errors, [], 'no script errors');
  console.log(JSON.stringify({ passed: true, prices: prices.length, questions: faq.length }));
})().catch(error => { console.error(error); process.exitCode = 1; });
