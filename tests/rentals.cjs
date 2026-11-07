const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');

// Run: node tests/rentals.cjs http://localhost:4173
// The motorcycle rentals page: every bike has a photo, a name and a booking link on Riders Share
// (the listing's Share link, which carries the referral code) and, where listed, Twisted Road.
// At each width nothing leaves the frame or scrolls sideways, buttons are full touch targets
// and the phone dock never covers a booking button. Screenshots go to test-results/rentals-*.png.
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const widths = [1920, 1650, 1440, 1280, 1024, 900, 820, 768, 680, 600, 414, 390, 375, 320];

(async () => {
  const home = await (await fetch(`${base}/`)).text();
  assert.match(home, /<a href="motorcycle-rentals\/" data-icon="moto" aria-label="Motorcycle Rentals"><span><span class="nav-extra">Motorcycle <\/span>Rentals<\/span><\/a>/, 'home navigation opens the rentals page');
  const resume = await (await fetch(`${base}/resume/`)).text();
  assert.match(resume, /<a href="\.\.\/motorcycle-rentals\/" data-icon="moto"/, 'resume navigation opens the rentals page');

  const page0 = await (await fetch(`${base}/motorcycle-rentals/`)).text();
  assert.match(page0, /class="rental-profiles">[\s\S]*href="https:\/\/www\.riders-share\.com\/user\/[^"]+\/ref-[^"]+"[\s\S]*href="https:\/\/www\.twistedroad\.com\/users\/[^"]+"/, 'profile links to both sites, Riders Share with the referral code');

  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const failures = [];
  try {
    for (const width of widths) {
      const phone = width <= 620;
      const page = await browser.newPage({ viewport: { width, height: phone ? 844 : 900 }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.url().startsWith(base) && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
      await page.goto(`${base}/motorcycle-rentals/`, { waitUntil: 'networkidle' });
      await page.evaluate(() => Promise.all([...document.images].map(img => { img.loading = 'eager'; return img.decode(); })));
      const r = await page.evaluate(() => {
        const box = el => el.getBoundingClientRect();
        const frame = box(document.querySelector('.page-frame'));
        const nav = document.querySelector('.site-header nav');
        const current = nav.querySelector('[aria-current="page"]');
        const bikes = [...document.querySelectorAll('.bike')].map(bike => {
          const img = bike.querySelector('.bike-photo img');
          const links = [...bike.querySelectorAll('.bike-links a')].map(a => {
            const b = box(a);
            const range = document.createRange(); range.selectNodeContents(a);
            return { platform: a.dataset.platform, href: a.href, text: a.textContent.trim(), width: b.width, height: b.height, lines: Math.round(range.getBoundingClientRect().height / parseFloat(getComputedStyle(a).lineHeight || 20)) };
          });
          return { name: bike.querySelector('h3')?.textContent.trim(), alt: img?.alt, loaded: !!img && img.complete && img.naturalWidth > 0, sharp: !!img && img.naturalWidth >= box(img).width * 1.5, left: box(bike).left, right: box(bike).right, links };
        });
        return {
          sideways: document.documentElement.scrollWidth > innerWidth,
          frame: { left: frame.left, right: frame.right },
          current: current && (current.getAttribute('aria-label') || current.textContent.trim()),
          navRows: new Set([...nav.querySelectorAll('a')].map(a => Math.round(box(a).top))).size,
          dockFixed: getComputedStyle(nav).position === 'fixed',
          bikes,
          blocks: [...document.querySelectorAll('.m-hero, .bike, .how, .site-footer, .bike-links .button')].map(el => ({ name: el.className, left: box(el).left, right: box(el).right })),
        };
      });
      const where = `${width}px`;
      try {
        assert.deepEqual(errors, [], `${where}: page errors or missing files`);
        assert.equal(r.sideways, false, `${where}: page scrolls sideways`);
        assert.equal(r.current, 'Motorcycle Rentals', `${where}: navigation marks the rentals page`);
        assert.equal(r.navRows, 1, `${where}: navigation stays on one row`);
        assert.equal(r.dockFixed, phone, `${where}: phone dock only on phones`);
        assert.ok(r.bikes.length >= 1, `${where}: at least one bike`);
        for (const bike of r.bikes) {
          assert.ok(bike.name, `${where}: bike has a name`);
          assert.ok(bike.loaded, `${where}: ${bike.name} photo loads`);
          assert.ok(bike.sharp, `${where}: ${bike.name} photo is sharp on 1.5x screens`);
          assert.ok(bike.alt && bike.alt.length > 10, `${where}: ${bike.name} photo has alt text`);
          const rs = bike.links.filter(l => l.platform === 'riders_share');
          assert.equal(rs.length, 1, `${where}: ${bike.name} has one Riders Share link`);
          const url = new URL(rs[0].href);
          assert.equal(url.hostname, 'www.riders-share.com', `${where}: ${bike.name} Riders Share host`);
          assert.match(url.pathname, /^\/listing\/[^/]+\/ref-[^/]+$/, `${where}: ${bike.name} Riders Share link is the listing's Share link with the referral code`);
          for (const l of bike.links.filter(l => l.platform === 'twisted_road')) assert.match(new URL(l.href).hostname, /(^|\.)twistedroad\.com$/, `${where}: ${bike.name} Twisted Road host`);
          assert.ok(bike.links.every(l => ['riders_share', 'twisted_road'].includes(l.platform)), `${where}: ${bike.name} links name their site`);
          assert.ok(bike.links.every(l => l.height >= 44 && l.width >= 44), `${where}: ${bike.name} buttons are 44px touch targets`);
          assert.ok(bike.links.every(l => l.lines <= 1), `${where}: ${bike.name} button labels stay on one line`);
        }
        for (const b of r.blocks) assert.ok(b.left >= r.frame.left - 1 && b.right <= r.frame.right + 1, `${where}: ${b.name} leaves the frame`);
        if (phone) {
          // Scroll each booking button into view; the dock must never sit on top of it at the end of the page.
          await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
          const covered = await page.evaluate(() => {
            const d = document.querySelector('.site-header nav').getBoundingClientRect();
            return [...document.querySelectorAll('.bike-links a, .site-footer a')].filter(a => { const r = a.getBoundingClientRect(); return r.bottom > d.top && r.top < d.bottom && r.right > d.left && r.left < d.right; }).map(a => a.textContent.trim());
          });
          assert.deepEqual(covered, [], `${where}: dock covers links at the end of the page`);
        }
      } catch (error) {
        failures.push(error.message);
      }
      await fs.mkdir('test-results', { recursive: true });
      await page.screenshot({ path: `test-results/rentals-${width}.png`, fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Rentals checks passed at ${widths.length} widths; screenshots in test-results/rentals-*.png`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
