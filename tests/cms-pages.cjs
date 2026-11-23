const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

// Run: node tests/cms-pages.cjs http://localhost:4173
// Cloud Media Shrinker's product, help, What's new and What's coming pages: What's new lists every version newest first,
// with a working anchor per version and where it came out; the other pages link to it; no stale "Coming in" badge
// is left once a version is out; in-page links resolve; nothing scrolls sideways at phone, tablet or desktop width.
// Every page has the product bar: the app, the five pages with the current one marked, Get the app on wider screens,
// and a back arrow on the inner pages when the bar is a band (1000 px and narrower).
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const out = path.join(__dirname, '..', 'test-results');
const pages = ['cloud-media-shrinker/', 'cloud-media-shrinker/help/', 'cloud-media-shrinker/whats-new/', 'cloud-media-shrinker/whats-coming/', 'cloud-media-shrinker/privacy/'];
// The product bar's links, in order, and which page each one is.
const barLinks = [['Overview', 'cloud-media-shrinker/'], ['Help', 'cloud-media-shrinker/help/'], ['What\'s new', 'cloud-media-shrinker/whats-new/'], ['What\'s coming', 'cloud-media-shrinker/whats-coming/'], ['Privacy', 'cloud-media-shrinker/privacy/']];
const widths = [1440, 1024, 900, 768, 414, 375, 320];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const failures = [];
  // 1.2.2 > 1.2.1 > 1.2 > 1.1 > 1.0: compare part by part, a missing part counting as 0.
  const compare = (a, b) => {
    const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
    for (let k = 0; k < Math.max(x.length, y.length); k++) if ((x[k] || 0) !== (y[k] || 0)) return (x[k] || 0) - (y[k] || 0);
    return 0;
  };
  // The newest version What's new shows as out somewhere (a dated release), read from the page.
  let newestOut = null;
  const check = async (label, fn) => {
    try { await fn(); console.log(`ok  ${label}`); } catch (error) { failures.push(`${label}: ${error.message.split('\n')[0]}`); console.log(`FAIL ${label}: ${error.message}`); }
  };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

    await check('What\'s new lists every version, newest first, with an anchor and where it came out', async () => {
      await page.goto(`${base}/cloud-media-shrinker/whats-new/`, { waitUntil: 'domcontentloaded' });
      const got = await page.evaluate(() => ({
        versions: [...document.querySelectorAll('.w-ver')].map(section => ({
          id: section.id,
          title: section.querySelector('h2').childNodes[1]?.textContent.trim(),
          anchor: section.querySelector('h2 .h-anchor')?.getAttribute('href'),
          where: [...section.querySelectorAll('.w-where li')].map(li => li.textContent.trim().replace(/\s+/g, ' ')),
          changes: section.querySelectorAll('.r-list li').length,
        })),
        jump: [...document.querySelectorAll('.w-versions a')].map(a => a.getAttribute('href')),
      }));
      assert.ok(got.versions.length >= 5, 'at least 1.0 to 1.2.2');
      for (let i = 1; i < got.versions.length; i++) {
        assert.ok(compare(got.versions[i - 1].title, got.versions[i].title) > 0, `${got.versions[i - 1].title} comes before ${got.versions[i].title}`);
      }
      for (const v of got.versions) {
        assert.equal(v.id, v.title.replaceAll('.', '-'), `${v.title} has the anchor #${v.title.replaceAll('.', '-')}`);
        assert.equal(v.anchor, `#${v.id}`, `${v.title}'s # links to itself`);
        assert.ok(v.where.length >= 1 && v.where.every(w => /\b20\d\d\b|review|first version/i.test(w)), `${v.title} says when and where it came out: ${v.where.join(' | ')}`);
        assert.ok(v.changes >= 1, `${v.title} lists what changed`);
      }
      assert.deepEqual(got.jump, got.versions.map(v => `#${v.id}`), 'the version links match the sections, in order');
      newestOut = got.versions.find(v => v.where.some(w => /\b20\d\d\b/.test(w)))?.title || null;
    });

    await check('a version link opens at its section', async () => {
      await page.goto(`${base}/cloud-media-shrinker/whats-new/#1-2-1`, { waitUntil: 'networkidle' });
      const top = await page.evaluate(() => document.getElementById('1-2-1').getBoundingClientRect().top);
      assert.ok(top >= -2 && top < 60, `#1-2-1 is at the top of the window (top ${Math.round(top)})`);
    });

    for (const url of pages) {
      await check(`/${url} links resolve and nothing out of date is marked coming`, async () => {
        await page.goto(`${base}/${url}`, { waitUntil: 'domcontentloaded' });
        const got = await page.evaluate(() => ({
          missing: [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter(h => h.length > 1 && !document.getElementById(decodeURIComponent(h.slice(1)))),
          whatsNew: [...document.querySelectorAll('main a')].some(a => new URL(a.href).pathname.endsWith('/cloud-media-shrinker/whats-new/')),
          badges: [...document.querySelectorAll('.soon')].map(b => b.textContent.trim()),
          headings: [...document.querySelectorAll('h2')].map(h => h.textContent.trim()),
        }));
        assert.deepEqual(got.missing, [], 'every # link has a target');
        if (!url.endsWith('whats-new/') && !url.endsWith('privacy/')) assert.ok(got.whatsNew, 'links to What\'s new');
        // Once a version is out anywhere, its "Coming in" badges come off (a platform still waiting says "Coming to iPhone"),
        // and What's coming drops its section.
        assert.ok(newestOut, 'What\'s new shows a version that is out');
        const stale = got.badges.filter(b => { const m = b.match(/^Coming in (\d+(?:\.\d+)+)$/); return m && compare(m[1], newestOut) <= 0; });
        assert.deepEqual(stale, [], `no "Coming in" badge for ${newestOut} or older`);
        if (url.endsWith('whats-coming/')) assert.ok(!got.headings.some(h => (h.match(/\b\d+\.\d+(?:\.\d+)?\b/g) || []).some(v => compare(v, newestOut) <= 0)), `What's coming has no section for ${newestOut} or older`);
      });
    }
    for (const url of pages) {
      await check(`/${url} has the product bar`, async () => {
        await page.goto(`${base}/${url}`, { waitUntil: 'domcontentloaded' });
        const got = await page.evaluate(() => {
          const bar = document.querySelector('.page-frame > nav.cms-nav[aria-label="Cloud Media Shrinker"]');
          if (!bar) return null;
          return {
            afterMark: bar.previousElementSibling?.classList.contains('site-mark'),
            beforeMain: bar.nextElementSibling?.tagName === 'MAIN',
            home: new URL(bar.querySelector('.cms-nav-home').href).pathname,
            homeText: bar.querySelector('.cms-nav-home').textContent.trim(),
            links: [...bar.querySelectorAll('.cms-nav-links a')].map(a => [a.textContent.trim(), new URL(a.href).pathname]),
            current: [...bar.querySelectorAll('[aria-current="page"]')].map(a => a.textContent.trim()),
            get: new URL(bar.querySelector('.cms-nav-get').href).pathname + new URL(bar.querySelector('.cms-nav-get').href).hash,
            oldBrand: document.querySelectorAll('main .c-brand, main > .eyebrow').length,
          };
        });
        assert.ok(got, 'the bar is right under the site header');
        assert.ok(got.afterMark && got.beforeMain, 'the bar sits between the header and the page');
        assert.equal(got.home, '/cloud-media-shrinker/', 'the app name goes to the product page');
        assert.equal(got.homeText, 'Cloud Media Shrinker');
        assert.deepEqual(got.links, barLinks.map(([text, href]) => [text, `/${href}`]), 'the five pages, in order');
        assert.deepEqual(got.current, [barLinks.find(([, href]) => href === url)[0]], 'this page is marked current');
        assert.equal(got.get, '/cloud-media-shrinker/#get', 'Get the app goes to the download box');
        assert.equal(got.oldBrand, 0, 'the old icon and label row is gone');
      });
    }
    await check('Get the app lands on the download box with both downloads', async () => {
      await page.goto(`${base}/cloud-media-shrinker/#get`, { waitUntil: 'networkidle' });
      const got = await page.evaluate(() => ({ stores: [...document.querySelectorAll('#get a[data-store]')].map(a => a.dataset.store), top: document.getElementById('get').getBoundingClientRect().top }));
      assert.ok(got.stores.includes('app_store') && got.stores.includes('direct'), `App Store and Mac download in #get (${got.stores})`);
      assert.ok(got.top >= 0 && got.top < 120, `#get is at the top of the window (top ${Math.round(got.top)})`);
    });
    await page.close();

    for (const scheme of ['light', 'dark']) {
      for (const width of widths) {
        const context = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 1000 }, colorScheme: scheme, reducedMotion: 'reduce' });
        const p = await context.newPage();
        for (const url of pages) {
          await check(`/${url} at ${width}px ${scheme}`, async () => {
            await p.goto(`${base}/${url}`, { waitUntil: 'networkidle' });
            const got = await p.evaluate(() => ({
              sideways: document.documentElement.scrollWidth > innerWidth,
              small: [...document.querySelectorAll('.w-versions a, .c-jump a')].filter(a => a.getClientRects().length).map(a => a.getBoundingClientRect()).filter(r => r.height < 44 || r.width < 44).length,
              rows: (() => { const tops = new Set([...document.querySelectorAll('.w-versions a')].map(a => Math.round(a.getBoundingClientRect().top))); return tops.size; })(),
              bar: (() => {
                const bar = document.querySelector('.cms-nav'); const shown = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
                const home = bar.querySelector('.cms-nav-home').getBoundingClientRect();
                const links = [...bar.querySelectorAll('.cms-nav-links a')].map(a => a.getBoundingClientRect());
                return { arrow: shown(bar.querySelector('.cms-nav-back')), get: shown(bar.querySelector('.cms-nav-get')), homeHeight: home.height, linkRows: new Set(links.map(r => Math.round(r.top))).size, smallLinks: links.filter(r => r.height < 40).length, oneRow: links.every(r => Math.abs(r.top + r.height / 2 - (home.top + home.height / 2)) < 4), band: getComputedStyle(bar).backgroundColor !== 'rgba(0, 0, 0, 0)' };
              })(),
            }));
            const inner = url !== 'cloud-media-shrinker/';
            assert.ok(got.bar.homeHeight >= 44, `the app name is a 44 px target (${got.bar.homeHeight})`);
            assert.equal(got.bar.smallLinks, 0, 'bar links are at least 40 px tall');
            if (width > 1000) {
              assert.ok(got.bar.oneRow && !got.bar.band && !got.bar.arrow && got.bar.get, 'wide screens: one row, no band, no arrow, Get the app shown');
            } else {
              assert.ok(got.bar.band, 'narrower screens: a tinted band');
              assert.equal(got.bar.arrow, inner, inner ? 'a back arrow on inner pages' : 'no back arrow on the product page');
              assert.ok(got.bar.linkRows <= 2, `the pages fit on at most two lines (${got.bar.linkRows})`);
              assert.equal(got.bar.get, width > 620, width > 620 ? 'Get the app on tablets' : 'no Get the app on phones');
            }
            assert.equal(got.sideways, false, 'no sideways scroll');
            assert.equal(got.small, 0, 'version and jump links are at least 44 px');
            if (url.endsWith('whats-new/') && width >= 360) assert.ok(got.rows <= 1, `the versions fit on one row (${got.rows} rows)`);
            if (width === 1440 || width === 375) await p.screenshot({ path: path.join(out, `cms-${url.split('/').filter(Boolean).slice(1).join('-') || 'product'}-${width}-${scheme}.png`), fullPage: true });
          });
        }
        await context.close();
      }
    }
  } finally { await browser.close(); }
  if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
  console.log(JSON.stringify({ passed: true }));
})();
