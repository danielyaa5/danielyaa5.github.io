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
  // Whether the newest version is still in Apple's review on some platform (a row marked w-pending on What's new).
  let newestPending = true;
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
      newestPending = got.versions[0].rows.some(r => r.pending);
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
        // Once the newest version is out on every platform, nothing may still say it's coming to one of them.
        if (!newestPending) assert.deepEqual(got.badges.filter(b => /^Coming to /.test(b)), [], 'no "Coming to" label once every platform has the newest version');
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
    // Help: Frequent questions start closed. A link to an answer (ours go out in support replies) opens it, scrolls to
    // it and lights it up; the link mark copies the answer's link without opening or closing anything.
    const helpUrl = `${base}/cloud-media-shrinker/help/`;
    const helpContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const faqState = (p) => p.evaluate(() => [...document.querySelectorAll('.h-faq')].filter(f => f.querySelector('details').open).map(f => f.id));
    await check('help: every frequent question starts closed, with its answer in the page', async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(helpUrl, { waitUntil: 'networkidle' });
      const got = await page.evaluate(() => [...document.querySelectorAll('.h-faq')].map(f => {
        const details = f.querySelector(':scope > details');
        const copy = f.querySelector('a.h-copy');
        const box = copy.getBoundingClientRect();
        return {
          id: f.id, open: details?.open, question: details?.querySelector(':scope > summary > h3')?.textContent.trim() || '',
          answer: details?.querySelector(':scope > .h-answer')?.textContent.trim().length || 0,
          inSummary: !!copy.closest('summary'), href: copy.getAttribute('href'), mark: copy.querySelector('[aria-hidden]').textContent,
          name: copy.getAttribute('aria-label') || copy.textContent, w: box.width, h: box.height,
          rowH: details.querySelector('summary').getBoundingClientRect().height,
        };
      }));
      assert.equal(got.length, 30, 'thirty answers');
      for (const f of got) {
        assert.equal(f.open, false, `#${f.id} starts closed`);
        assert.ok(f.question.length > 5 && f.answer > 40, `#${f.id} has its question and answer in the HTML`);
        assert.equal(f.href, `#${f.id}`, `#${f.id} link mark points at its own answer`);
        assert.equal(f.mark, '\u{1F517}', `#${f.id} link mark is the link emoji`);
        assert.match(f.name, /Copy link to this answer/, `#${f.id} link mark is named`);
        assert.equal(f.inSummary, false, `#${f.id} link mark is outside the summary, so it never toggles the answer`);
        assert.ok(f.rowH >= 44, `#${f.id} question row is at least 44 px tall (${f.rowH})`);
      }
    });
    await check('help: a link to an answer opens it, scrolls to it and highlights it', async () => {
      const fresh = await helpContext.newPage();
      await fresh.route('**/analytics.js*', route => route.abort());
      await fresh.goto(`${helpUrl}#still-locked`, { waitUntil: 'networkidle' });
      assert.deepEqual(await faqState(fresh), ['still-locked'], 'arriving on #still-locked opens only that answer');
      const lit = () => fresh.evaluate(() => {
        const hash = location.hash.slice(1);
        // How an answer is painted: compared with another open answer that isn't the target.
        const look = (id) => [document.getElementById(id), document.querySelector(`#${id} details`)].map(el => { const s = getComputedStyle(el); return [s.backgroundColor, s.borderTopColor, s.boxShadow].join(' '); }).join(' | ');
        const target = document.getElementById(hash);
        const answer = target.querySelector('.h-answer').getBoundingClientRect();
        const other = document.querySelector('#one-time details');
        other.open = true;
        const lit = look(hash) !== look('one-time');
        other.open = false;
        return { top: target.getBoundingClientRect().top, lit, answer: answer.height, marked: [...document.querySelectorAll('.h-faq.is-target')].map(f => f.id) };
      });
      let got = await lit();
      assert.ok(got.top >= 0 && got.top < 120, `the answer is at the top of the window (top ${Math.round(got.top)})`);
      assert.ok(got.lit && got.answer > 40, 'it is highlighted and its answer shows');
      // The address changes on a page that's already open.
      await fresh.evaluate(() => { location.hash = '#family-sharing'; });
      await fresh.waitForFunction(() => document.querySelector('#family-sharing details').open);
      got = await lit();
      assert.ok(got.top >= 0 && got.top < 120 && got.lit, `a changed address opens, scrolls to and highlights the new answer (top ${Math.round(got.top)})`);
      assert.deepEqual(got.marked, ['family-sharing'], 'only the new answer is marked');
      // A link inside one answer to another answer.
      await fresh.locator('#family-sharing .h-answer a[href="#share-family"]').click();
      await fresh.waitForFunction(() => document.querySelector('#share-family details').open);
      got = await lit();
      assert.ok(got.top >= 0 && got.top < 120 && got.lit, 'a link on the page to another answer opens it');
      // Close it, then follow the same link again: the address doesn't change, and it still opens.
      await fresh.locator('#share-family summary').click();
      assert.equal(await fresh.evaluate(() => document.querySelector('#share-family details').open), false, 'a click on the question closes it');
      await fresh.locator('#family-sharing .h-answer a[href="#share-family"]').click();
      assert.equal(await fresh.evaluate(() => document.querySelector('#share-family details').open), true, 'the same link opens it again');
      await fresh.close();
    });
    await check('help: questions open by click and by keyboard; the link mark copies without toggling; one button opens them all', async () => {
      await helpContext.grantPermissions(['clipboard-read', 'clipboard-write']);
      const fresh = await helpContext.newPage();
      await fresh.route('**/analytics.js*', route => route.abort());
      await fresh.goto(helpUrl, { waitUntil: 'networkidle' });
      await fresh.locator('#metadata summary').click();
      assert.deepEqual(await faqState(fresh), ['metadata'], 'a click opens the question');
      await fresh.locator('#quality summary').focus();
      await fresh.keyboard.press('Enter');
      assert.deepEqual(await faqState(fresh), ['metadata', 'quality'], 'Enter on a focused question opens it, and the first stays open');
      await fresh.keyboard.press('Space');
      assert.deepEqual(await faqState(fresh), ['metadata'], 'Space closes it again');
      // The link mark on a closed question and on an open one.
      for (const id of ['one-time', 'metadata']) {
        const before = await faqState(fresh);
        await fresh.locator(`#${id} a.h-copy`).click();
        assert.deepEqual(await faqState(fresh), before, `the link mark on #${id} leaves every answer as it was`);
        assert.equal(await fresh.evaluate(() => navigator.clipboard.readText()), `${helpUrl}#${id}`, `#${id}: the answer's link is on the clipboard`);
        assert.equal(await fresh.locator(`#${id} a.h-copy`).getAttribute('data-copied'), 'Link copied', 'it says the link was copied');
        assert.equal(new URL(fresh.url()).hash, `#${id}`, 'the address shows the answer');
      }
      const button = fresh.locator('.h-openall');
      assert.equal((await button.textContent()).trim(), 'Open all answers');
      await button.click();
      assert.equal((await faqState(fresh)).length, 30, 'Open all answers opens all thirty');
      assert.equal((await button.textContent()).trim(), 'Close all answers');
      await button.click();
      assert.deepEqual(await faqState(fresh), [], 'Close all answers closes them');
      await fresh.close();
      await helpContext.close();
    });
    await check('help: the iPhone and Mac badges in headings are sized with the heading and keep its lines even', async () => {
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(helpUrl, { waitUntil: 'networkidle' });
        const got = await page.evaluate(() => [...document.querySelectorAll('.h-sec h3')].filter(h => h.querySelector('.tag')).map(h => {
          const style = getComputedStyle(h), box = h.getBoundingClientRect(), tag = h.querySelector('.tag'), t = tag.getBoundingClientRect();
          return { text: h.textContent.trim().slice(0, 30), ratio: parseFloat(getComputedStyle(tag).fontSize) / parseFloat(style.fontSize), lines: box.height / parseFloat(style.lineHeight), inside: t.left >= box.left - 1 && t.right <= box.right + 1 && t.top >= box.top - 1 };
        }));
        assert.equal(got.length, 11, 'eleven headings carry a badge');
        for (const h of got) {
          assert.ok(h.ratio >= 0.8 && h.ratio <= 1, `${width}px "${h.text}": badge text is 80 to 100% of the heading's size (${h.ratio.toFixed(2)})`);
          assert.ok(Math.abs(h.lines - Math.round(h.lines)) < 0.04, `${width}px "${h.text}": the badge doesn't stretch its line (${h.lines.toFixed(2)} lines)`);
          assert.ok(h.inside, `${width}px "${h.text}": the badge stays inside the heading`);
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    });
    await check('help without JavaScript: questions still open, and a link still lands on its answer', async () => {
      const plain = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false, reducedMotion: 'reduce' });
      const p = await plain.newPage();
      await p.goto(`${helpUrl}#still-locked`, { waitUntil: 'load' });
      // The page scrolls to the link by itself; give it a moment to settle.
      let box = await p.locator('#still-locked').boundingBox();
      for (let i = 0; i < 20 && !(box.y >= 0 && box.y < 120); i += 1) { await p.waitForTimeout(100); box = await p.locator('#still-locked').boundingBox(); }
      assert.ok(box.y >= 0 && box.y < 120, `the link lands on the question (top ${Math.round(box.y)})`);
      assert.equal(await p.locator('.h-tools').isVisible(), false, 'no dead Open all button');
      await p.locator('#still-locked summary').click();
      assert.ok(await p.locator('#still-locked .h-answer').isVisible(), 'a tap opens the answer');
      await plain.close();
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
