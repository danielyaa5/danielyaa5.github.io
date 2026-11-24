const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

// Run: node tests/cms-pages.cjs http://localhost:4173
// Cloud Media Shrinker's product, help, What's new and What's coming pages: What's new lists every version newest first,
// with a working anchor per version and where it came out; the other pages link to it; no stale "Coming in" badge
// is left once a version is out; in-page links resolve; nothing scrolls sideways at phone, tablet or desktop width.
// Every page has the product bar: the app, the five pages with the current one marked, Get the app on wider screens
// (except the product page, whose own download buttons are right below), and a back arrow on the inner pages when
// the bar is a band (1000 px and narrower).
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const out = path.join(__dirname, '..', 'test-results');
const pages = ['cloud-media-shrinker/', 'cloud-media-shrinker/help/', 'cloud-media-shrinker/whats-new/', 'cloud-media-shrinker/whats-coming/', 'cloud-media-shrinker/privacy/'];
// The product bar's links, in order, and which page each one is.
const barLinks = [['Overview', 'cloud-media-shrinker/'], ['Help', 'cloud-media-shrinker/help/'], ['What\'s new', 'cloud-media-shrinker/whats-new/'], ['What\'s coming', 'cloud-media-shrinker/whats-coming/'], ['Privacy', 'cloud-media-shrinker/privacy/']];
const widths = [1440, 1024, 900, 768, 660, 414, 375, 320];

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
          rows: [...section.querySelectorAll('.w-where li')].map(li => {
            const a = li.querySelector('a');
            return { pending: li.classList.contains('w-pending'), text: li.querySelector('.w-place').textContent, href: a?.href || null, store: a?.dataset.store || null, noCapture: !!a?.classList.contains('ph-no-capture') };
          }),
          changes: section.querySelectorAll('.r-list li').length,
        })),
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
        // Each release row is a link to where you get it, except a platform still in review.
        for (const r of v.rows) {
          if (r.pending) { assert.equal(r.href, null, `${v.title} ${r.text}: a row in review isn't a link`); continue; }
          const direct = r.text === 'Free download for Mac';
          assert.equal(r.store, direct ? 'direct' : 'app_store', `${v.title} ${r.text}: data-store`);
          assert.equal(r.href, direct ? `https://github.com/danielyaa5/cloud-media-shrinker/releases/download/v${v.title}/Cloud-Media-Shrinker-${v.title}.zip` : 'https://apps.apple.com/app/cloud-media-shrinker/id6824383256', `${v.title} ${r.text}: link`);
          assert.ok(r.noCapture, `${v.title} ${r.text}: ph-no-capture, so the click counts once`);
        }
      }
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
          whatsNew: [...document.querySelectorAll('.cms-nav a, main a')].some(a => new URL(a.href).pathname.endsWith('/cloud-media-shrinker/whats-new/')),
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
    const barPositions = [];
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
            get: bar.querySelector('.cms-nav-get') ? new URL(bar.querySelector('.cms-nav-get').href).pathname + new URL(bar.querySelector('.cms-nav-get').href).hash : null,
            oldBrand: document.querySelectorAll('main .c-brand, main > .eyebrow').length,
            weights: [...bar.querySelectorAll('.cms-nav-links a')].map(a => Number(getComputedStyle(a).fontWeight)),
            widths: [...bar.querySelectorAll('.cms-nav-links a')].map(a => Math.round(a.getBoundingClientRect().width)),
          };
        });
        assert.ok(got, 'the bar is right under the site header');
        assert.ok(got.afterMark && got.beforeMain, 'the bar sits between the header and the page');
        assert.equal(got.home, '/cloud-media-shrinker/', 'the app name goes to the product page');
        assert.equal(got.homeText, 'Cloud Media Shrinker');
        assert.deepEqual(got.links, barLinks.map(([text, href]) => [text, `/${href}`]), 'the five pages, in order');
        assert.deepEqual(got.current, [barLinks.find(([, href]) => href === url)[0]], 'this page is marked current');
        if (url === 'cloud-media-shrinker/') assert.equal(got.get, null, 'no Get the app on the product page, which has its own download buttons');
        else assert.equal(got.get, '/cloud-media-shrinker/#get', 'Get the app goes to the download box');
        assert.equal(got.oldBrand, 0, 'the old icon and label row is gone');
        const currentIndex = barLinks.findIndex(([, href]) => href === url);
        assert.ok(got.weights.every((w, i) => i === currentIndex ? w >= 700 : w < 600), `only the current page is bold (${got.weights})`);
        barPositions.push([url, got.widths.join(',')]);
      });
    }
    await check('the bar\'s links keep the same widths on every page', async () => {
      // The bold current page must not push the links after it along, so each link is as wide on every page.
      assert.equal(new Set(barPositions.map(([, lefts]) => lefts)).size, 1, barPositions.map(([u, l]) => `${u}: ${l}`).join(' | '));
    });
    await check('Get the app lands on the download box with both downloads', async () => {
      await page.goto(`${base}/cloud-media-shrinker/#get`, { waitUntil: 'networkidle' });
      const got = await page.evaluate(() => ({ stores: [...document.querySelectorAll('#get a[data-store]')].map(a => a.dataset.store), top: document.getElementById('get').getBoundingClientRect().top }));
      assert.ok(got.stores.includes('app_store') && got.stores.includes('direct'), `App Store and Mac download in #get (${got.stores})`);
      assert.ok(got.top >= 0 && got.top < 120, `#get is at the top of the window (top ${Math.round(got.top)})`);
    });
    await check('Get the app never sits over the page links, at any width', async () => {
      // In the band, the pill is on the app's row and the links wrap below it; it must clear the last link (Privacy).
      await page.goto(`${base}/cloud-media-shrinker/help/`, { waitUntil: 'networkidle' });
      const tight = [];
      for (let width = 600; width <= 1440; width += 2) {
        await page.setViewportSize({ width, height: 700 });
        const gap = await page.evaluate(() => {
          const pill = document.querySelector('.cms-nav-get');
          if (getComputedStyle(pill).display === 'none') return null;
          const p = pill.getBoundingClientRect();
          return Math.min(...[...document.querySelectorAll('.cms-nav-links a')].map(a => a.getBoundingClientRect()).map(r => (r.bottom <= p.top || r.top >= p.bottom) ? p.left - r.right : Infinity));
        });
        if (gap !== null && gap < 24) tight.push(`${width}px: ${Math.round(gap)} px`);
      }
      assert.deepEqual(tight, [], 'the pill clears every link by at least 24 px');
      await page.setViewportSize({ width: 1440, height: 900 });
    });
    await check('every Cloud Media Shrinker page is in the sitemap', async () => {
      const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
      const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
      const missing = [...pages, 'cloud-media-shrinker/compare/'].map(u => `https://danielyakobian.com/${u}`).filter(u => !listed.includes(u));
      assert.deepEqual(missing, [], 'listed in sitemap.xml');
    });
    await check('privacy: the at-a-glance diagram, and the policy sentences it summarizes', async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${base}/cloud-media-shrinker/privacy/`, { waitUntil: 'domcontentloaded' });
      const got = await page.evaluate(() => {
        const glance = document.querySelector('.c-legal .p-glance');
        const policy = [...document.querySelectorAll('.c-legal > p, .c-legal > h2')].map(e => e.textContent).join(' ').replace(/\s+/g, ' ');
        return {
          afterTitle: glance?.previousElementSibling?.classList.contains('c-updated'),
          device: glance?.querySelectorAll('.p-device li:not(.p-chips li)').length,
          dests: [...(glance?.querySelectorAll('.p-dest b') || [])].map(b => b.textContent),
          cards: [...(glance?.querySelectorAll('.p-card h3') || [])].map(h => h.textContent),
          policy,
        };
      });
      assert.ok(got.afterTitle, 'the diagram sits under the title and date, above the policy');
      assert.equal(got.device, 4, 'four things never sent automatically');
      assert.deepEqual(got.dests, ['Apple', 'Polar, or the developer’s unlock relay', 'The support inbox', 'The developer']);
      assert.deepEqual(got.cards, ['Stays on your device', 'Only if you choose', 'Not in the app at all']);
      // Every line on the diagram summarizes one of these. If the policy changes, change the diagram with it.
      for (const source of [
        'does not automatically send your photos, videos, filenames, captions, location information or library contents to the developer',
        'no advertising, tracking or analytics SDKs and does not require a Cloud Media Shrinker account',
        'Apple Photos may download media from iCloud when you preview or compress it',
        'App Store editions use Apple’s purchase system',
        'a random reference for this installation',
        'every hour while it runs',
        'The app never sends Polar your photos, filenames, library information or your Mac’s name',
        'The app never sends your photos, filenames, library information or your Mac’s name',
        'the text you entered, your optional reply email, selected screenshots, and app diagnostics if included',
        'You can review the exact diagnostics and exclude them before sending',
        'They are not sent to the developer',
        'does not request your Google password or connect directly to your Google account',
        'The developer has no server copy of your library',
      ]) assert.ok(got.policy.includes(source), `the policy still says: ${source}`);
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
              small: [...document.querySelectorAll('.c-jump a, .w-where a')].filter(a => a.getClientRects().length).map(a => a.getBoundingClientRect()).filter(r => r.height < 44 || r.width < 44).length,
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
              assert.ok(got.bar.oneRow && !got.bar.band && !got.bar.arrow, 'wide screens: one row, no band, no arrow');
              assert.equal(got.bar.get, inner, inner ? 'Get the app shown' : 'no Get the app on the product page');
            } else {
              assert.ok(got.bar.band, 'narrower screens: a tinted band');
              assert.equal(got.bar.arrow, inner, inner ? 'a back arrow on inner pages' : 'no back arrow on the product page');
              assert.ok(got.bar.linkRows <= 2, `the pages fit on at most two lines (${got.bar.linkRows})`);
              assert.equal(got.bar.get, inner && width >= 724, !inner ? 'no Get the app on the product page' : width >= 724 ? 'Get the app on wide tablets' : 'no Get the app below 724 px');
            }
            assert.equal(got.sideways, false, 'no sideways scroll');
            if (url.endsWith('privacy/')) {
              // The map's line runs inside the frame: on phones the cards step in from the device block.
              const map = await p.evaluate(() => { const d = document.querySelector('.p-device').getBoundingClientRect(); const c = document.querySelector('.p-dest').getBoundingClientRect(); const f = document.querySelector('.c-legal').getBoundingClientRect(); return { device: d.left, dest: c.left, deviceRight: d.right, frame: f.left }; });
              if (width <= 620) assert.ok(map.dest >= map.device + 30, `phone: the cards step in from the device block (${Math.round(map.dest - map.device)} px)`);
              else assert.ok(map.dest >= map.deviceRight + 30, `the cards sit right of the device block (${Math.round(map.dest - map.deviceRight)} px)`);
            }
            assert.equal(got.small, 0, 'jump links and release rows are at least 44 px');
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
