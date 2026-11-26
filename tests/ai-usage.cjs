const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const root = path.join(__dirname, '..');
const out = path.join(root, 'test-results', 'ai-usage');
const widths = [1920, 1650, 1440, 1280, 1024, 900, 768, 600, 414, 375, 320];
const routes = ['/ai-usage/', '/ai-usage/help/', '/ai-usage/privacy/'];
const store = 'https://apps.apple.com/app/ai-usage-monitor-widget/id6832427898';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, '.metadata_never_index'), '');
  fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify({ passed: false, status: 'running', startedAt: new Date().toISOString() }, null, 2));
  for (const asset of ['social-card.jpg', 'icon.png']) assert.ok(fs.existsSync(path.join(root, 'assets', 'ai-usage', asset)), `${asset} exists`);
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const errors = [];
  const badResponses = [];
  const instrument = async context => {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === new URL(base).origin && !url.pathname.startsWith('/dy-relay/') ? route.continue() : route.abort();
    });
    context.on('page', page => {
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (new URL(response.url()).origin === new URL(base).origin && response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`); });
    });
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    // No external requests or analytics leave any test context.
    await instrument(context);
    const page = await context.newPage();
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    const tile = page.locator('article.project').filter({ has: page.getByRole('link', { name: 'AI Usage', exact: true }) });
    assert.equal(await tile.locator('.project-name').getAttribute('href'), 'ai-usage/');
    assert.equal(await tile.locator('.project-link').first().getAttribute('href'), 'ai-usage/');
    assert.match(await tile.innerText(), /Mac App Store/);
    assert.doesNotMatch(await tile.innerText(), /in review/);
    await tile.locator('.project-name').click();
    await page.waitForURL(base + '/ai-usage/');
    assert.equal(await page.locator('h1').innerText(), 'Your AI limits, a glance away.');
    assert.equal(await page.locator('.c-hero [data-store]').getAttribute('href'), store);
    assert.equal(await page.locator('a[data-store]').count(), 2);
    assert.equal(await page.locator('.c-actions a:not([data-store])').first().getAttribute('href'), 'https://github.com/danielyaa5/ai-usage');
    const schema = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
    assert.equal(schema.name, 'AI Usage Monitor Widget');
    assert.equal(schema.operatingSystem, 'macOS 14 or later');
    assert.equal(schema.isAccessibleForFree, undefined);
    assert.equal(schema.offers, undefined);
    assert.ok(schema.sameAs.includes(store));
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto', 'root respects reduced motion');
    assert.notEqual(await page.locator('.ai-skip').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'skip link uses the root paper token');
    const socialURL = new URL(await page.locator('meta[property="og:image"]').getAttribute('content'));
    const faviconURL = new URL(await page.locator('link[rel="icon"]').getAttribute('href'), base);
    for (const [url, dimensions] of [[socialURL, [1200, 630]], [faviconURL, [128, 128]]]) {
      const response = await page.request.get(base + url.pathname);
      assert.ok(response.ok(), `${url.pathname} responds successfully`);
      const actual = await page.evaluate(async src => { const img = new Image(); img.src = src; await img.decode(); return [img.naturalWidth, img.naturalHeight]; }, base + url.pathname);
      assert.deepEqual(actual, dimensions, `${url.pathname} has the intended dimensions`);
    }
    const shot = page.locator('.c-feature a.c-zoom').first();
    assert.match(await shot.getAttribute('aria-label'), /View full screenshot/);
    assert.equal(await shot.locator('.for-touch').textContent(), 'View full screenshot');
    assert.match(await page.locator('.site-footer a[href="#top"]').getAttribute('aria-label'), /Daniel/);
    await shot.scrollIntoViewIfNeeded();
    await shot.hover();
    assert.equal(await shot.evaluate(el => el.classList.contains('is-zoomed')), false, 'reduced motion disables hover zoom');
    await shot.click();
    await page.waitForSelector('dialog.c-viewer[open]');
    assert.equal(await page.locator('.c-viewer-count').textContent(), '1 of 3');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.c-viewer-count').textContent === '2 of 3');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog.c-viewer').open);
    assert.equal(await shot.evaluate(el => el === document.activeElement), true, 'Escape restores screenshot focus');
    await page.waitForFunction(() => !history.state?.cViewer);
    await shot.click();
    await page.locator('.c-viewer-close').click();
    await page.waitForFunction(() => !document.querySelector('dialog.c-viewer').open);
    await page.waitForFunction(() => !history.state?.cViewer);
    await page.locator('.cms-nav a', { hasText: 'Help' }).click();
    await page.waitForURL(base + '/ai-usage/help/');
    assert.match(await page.locator('main').innerText(), /Connect Claude Desktop/);
    assert.match(await page.locator('main').innerText(), /interactive Claude Code terminal/);
    assert.match(await page.locator('main').innerText(), /Preview with sample data/);
    for (const id of ['claude', 'chatgpt', 'google', 'first-widget', 'waiting-for-data']) {
      await page.goto(base + '/ai-usage/help/#' + id);
      assert.equal(await page.locator('#' + id).count(), 1, `Help deep link #${id} resolves`);
      assert.equal(new URL(page.url()).hash, '#' + id);
    }
    await page.locator('.cms-nav a', { hasText: 'Privacy' }).click();
    await page.waitForURL(base + '/ai-usage/privacy/');
    assert.match(await page.locator('main').innerText(), /If you paste the optional setup request/);
    assert.match(await page.locator('main').innerText(), /does not read your existing Codex credentials/);
    await page.locator('.cms-nav a', { hasText: 'Support' }).click();
    await page.waitForURL(base + '/ai-usage/#support');
    assert.equal(await page.locator('#support').isVisible(), true);
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      for (const width of widths) {
        await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
        for (const route of routes) {
          await page.goto(base + route, { waitUntil: 'networkidle' });
          await page.evaluate(async () => { for (const img of document.images) { img.loading = 'eager'; } await Promise.all([...document.images].map(img => img.decode().catch(() => {}))); });
          const state = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth > innerWidth,
            broken: [...document.images].filter(img => !img.complete || !img.naturalWidth).map(img => img.src),
            targets: [...document.querySelectorAll('.cms-nav-links a, .c-actions a, .c-jump a, .ai-support-links a')].filter(el => el.getClientRects().length).filter(el => el.getBoundingClientRect().height < 44).map(el => el.textContent),
            anchors: [...document.querySelectorAll('a[href^="#"]')].filter(el => !document.getElementById(el.hash.slice(1))).map(el => el.hash),
            canonical: document.querySelector('link[rel="canonical"]').href,
          }));
          assert.equal(state.overflow, false, `${route} ${width} ${colorScheme}: no sideways scroll`);
          assert.deepEqual(state.broken, [], 'images load');
          assert.deepEqual(state.targets, [], '44px actions');
          assert.deepEqual(state.anchors, [], 'local anchors resolve');
          assert.equal(state.canonical, 'https://danielyakobian.com' + route);
          if (route === '/ai-usage/') {
            assert.equal(await page.locator('.c-hero img').evaluate(img => img.currentSrc), await page.locator('.c-feature').nth(2).locator('img').evaluate(img => img.currentSrc), 'menu hero and feature reuse the same format');
          }
          const slug = route.split('/').filter(Boolean).slice(1).join('-') || 'overview';
          if (route === routes[0] || [1440,768,375].includes(width)) {
            await page.screenshot({ path: path.join(out, `${slug}-${width}-${colorScheme}.png`), fullPage: true });
          }
          results.push({ route, width, colorScheme, passed: true });
        }
      }
    }
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      for (const width of [1440, 768, 375]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(base + '/', { waitUntil: 'networkidle' });
        const homeTile = page.locator('article.project').filter({ has: page.getByRole('link', { name: 'AI Usage', exact: true }) });
        assert.match(await homeTile.locator('.project-benefit').textContent(), /menu bar.*desktop widgets/);
        assert.equal(await homeTile.locator('.project-link').nth(1).getAttribute('href'), 'https://github.com/danielyaa5/ai-usage');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'home does not overflow');
        await homeTile.screenshot({ path: path.join(out, `home-tile-${width}-${colorScheme}.png`) });
      }
    }
    const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
    for (const route of routes) assert.ok(sitemap.includes(`<loc>https://danielyakobian.com${route}</loc>`));
    await context.close();
    const mouseContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await instrument(mouseContext);
    const mousePage = await mouseContext.newPage();
    await mousePage.goto(base + '/ai-usage/', { waitUntil: 'networkidle' });
    const hoverShot = mousePage.locator('.c-feature a.c-zoom').first();
    await hoverShot.hover();
    assert.equal(await hoverShot.evaluate(el => el.classList.contains('is-zoomed')), true);
    await mousePage.screenshot({ path: path.join(out, 'hover-zoom.png') });
    await mouseContext.close();
    const phone = await browser.newContext({ viewport: { width: 375, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await instrument(phone);
    const tab = await phone.newPage();
    await tab.goto(base + '/ai-usage/', { waitUntil: 'networkidle' });
    const phoneShot = tab.locator('.c-feature a.c-zoom').first();
    await phoneShot.scrollIntoViewIfNeeded();
    assert.equal(await phoneShot.locator('.for-touch').isVisible(), true);
    await Promise.all([tab.waitForURL(base + '/assets/ai-usage/limits.webp'), phoneShot.tap()]);
    assert.equal(await tab.locator('body > img').evaluate(img => img.naturalWidth), 1440, 'phone opens the original full screenshot');
    await phone.close();
    assert.deepEqual(errors, [], 'no browser errors in any context');
    assert.deepEqual(badResponses, [], 'no failed same-origin requests');
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify({ passed: true, results }, null, 2));
  console.log('AI Usage: home tile, product/help/privacy/support, store/source links, screenshot keyboard/mouse/touch flow and 66 responsive route/theme checks passed.');
})().catch(error => { fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify({ passed: false, status: 'failed', error: error.message }, null, 2)); console.error(error); process.exitCode = 1; });
