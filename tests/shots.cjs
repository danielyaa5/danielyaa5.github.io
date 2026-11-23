const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// Run: node tests/shots.cjs http://localhost:4173
// The feature screenshots on the Cloud Media Shrinker page link to their full-size files. With a mouse, hovering zooms in
// where the pointer is (using the full-size file). Wider than 850px a click opens the full-screen viewer: arrow keys,
// Esc, a click on the dark area and Back close it without leaving the page, and narrowing the window closes it. At 850px
// and narrower a click or tap opens the image itself. Reduced motion turns the hover zoom off. No sideways scroll at
// 1440-320px, light and dark.
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const url = `${base}/cloud-media-shrinker/`;
const scaleOf = transform => (transform === 'none' ? 1 : Number(transform.match(/matrix\(([^,]+)/)?.[1] || 1));

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    // A computer, wide window: hover zoom, then the viewer.
    const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await desk.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    const shots = page.locator('.c-feature a.c-zoom');
    assert.equal(await shots.count(), 5, 'every feature screenshot is a link');
    for (let i = 0; i < 5; i += 1) {
      const [href, src, label] = await shots.nth(i).evaluate(link => [link.getAttribute('href'), link.querySelector('img').getAttribute('src'), link.getAttribute('aria-label')]);
      assert.equal(href, src, 'each links to its full-size file');
      assert.match(label, /^View full size: /, 'the link says what it does');
    }
    const second = shots.nth(1);
    await second.scrollIntoViewIfNeeded();
    const box = await second.boundingBox();
    const state = () => second.evaluate(link => {
      const img = link.querySelector('img');
      const style = getComputedStyle(img);
      const badge = link.querySelector('.c-zoom-badge');
      return { zoomed: link.classList.contains('is-zoomed'), transform: style.transform, origin: style.transformOrigin, badge: getComputedStyle(badge).opacity, label: badge.innerText.trim(), width: link.clientWidth };
    });
    assert.equal((await state()).badge, '0', 'the hint is hidden until hover');
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.4);
    await page.waitForTimeout(400);
    let now = await state();
    assert.ok(now.zoomed && scaleOf(now.transform) >= 1.8, `hovering zooms in; got ${now.transform}`);
    assert.deepEqual([now.badge, now.label], ['1', 'Click to enlarge'], 'the hint shows on hover');
    assert.ok(Math.abs(parseFloat(now.origin) - now.width * 0.25) < 3, `the zoom centers on the pointer; origin ${now.origin} for width ${now.width}`);
    await page.waitForFunction(() => /screenshot-shrink\.webp$/.test(document.querySelectorAll('.c-feature a.c-zoom img')[1].currentSrc));
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.4);
    now = await state();
    assert.ok(Math.abs(parseFloat(now.origin) - now.width * 0.75) < 3, `the zoom follows the pointer; origin ${now.origin}`);
    await page.mouse.move(box.x - 60, box.y - 60);
    await page.waitForTimeout(400);
    assert.equal(scaleOf((await state()).transform), 1, 'leaving zooms back out');

    const viewer = () => page.evaluate(() => {
      const dialog = document.querySelector('dialog.c-viewer');
      return { open: Boolean(dialog?.open), count: dialog?.querySelector('.c-viewer-count').textContent, locked: document.documentElement.classList.contains('c-viewer-open'), path: location.pathname, focus: document.activeElement?.getAttribute('aria-label') || '' };
    });
    const closed = () => page.waitForFunction(() => !document.querySelector('dialog.c-viewer').open);
    await second.click();
    await page.waitForSelector('dialog.c-viewer[open]');
    let seen = await viewer();
    assert.deepEqual([seen.open, seen.count, seen.locked, seen.path], [true, '2 of 5', true, '/cloud-media-shrinker/'], `a click opens the viewer on that screenshot; got ${JSON.stringify(seen)}`);
    assert.match(await page.locator('.c-viewer-slide').nth(1).textContent(), /02\s*Choose how much to compress/, 'the slide names its feature');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.c-viewer-count').textContent === '3 of 5');
    await page.keyboard.press('Escape');
    await closed();
    await page.waitForTimeout(200);
    seen = await viewer();
    assert.deepEqual([seen.locked, seen.path], [false, '/cloud-media-shrinker/'], 'Esc closes it, the page scrolls again and stays put');
    assert.match(seen.focus, /^View full size: Compression presets/, 'focus goes back to the screenshot');
    await second.click();
    await page.waitForSelector('dialog.c-viewer[open]');
    await page.mouse.click(30, 200); // dark area above the left arrow
    await closed();
    await second.click();
    await page.waitForSelector('dialog.c-viewer[open]');
    await page.evaluate(() => history.back());
    await closed();
    await page.waitForTimeout(200);
    assert.equal((await viewer()).path, '/cloud-media-shrinker/', 'Back closes the viewer without leaving the page');
    await second.click();
    await page.waitForSelector('dialog.c-viewer[open]');
    await page.setViewportSize({ width: 800, height: 900 });
    await closed();

    // A computer, narrow window: hovering still zooms, and a click opens the image itself.
    await page.waitForTimeout(300);
    await second.scrollIntoViewIfNeeded();
    const narrow = await second.boundingBox();
    await page.mouse.move(narrow.x + narrow.width / 2, narrow.y + narrow.height / 2);
    await page.waitForTimeout(300);
    assert.ok((await state()).zoomed, 'hover zoom works in a narrow window too');
    await Promise.all([page.waitForURL(/screenshot-shrink\.webp$/), page.mouse.click(narrow.x + narrow.width / 2, narrow.y + narrow.height / 2)]);
    await desk.close();

    // Reduced motion: no hover zoom, and a click still opens the viewer.
    const calm = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const calmPage = await calm.newPage();
    await calmPage.goto(url, { waitUntil: 'networkidle' });
    const calmShot = calmPage.locator('.c-feature a.c-zoom').nth(1);
    await calmShot.scrollIntoViewIfNeeded();
    await calmShot.hover();
    await calmPage.waitForTimeout(300);
    assert.equal(await calmShot.evaluate(link => link.classList.contains('is-zoomed')), false, 'reduced motion: no hover zoom');
    await calmShot.click();
    await calmPage.waitForSelector('dialog.c-viewer[open]');
    await calm.close();

    // A phone: the hint always shows, and a tap opens the image itself.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const tab = await phone.newPage();
    await tab.goto(url, { waitUntil: 'networkidle' });
    const phoneShot = tab.locator('.c-feature a.c-zoom').nth(1);
    await phoneShot.scrollIntoViewIfNeeded();
    const hint = await phoneShot.locator('.c-zoom-badge').evaluate(badge => [badge.innerText.trim(), getComputedStyle(badge).opacity]);
    assert.deepEqual(hint, ['Tap to enlarge', '1'], 'the hint always shows on a phone');
    await Promise.all([tab.waitForURL(/screenshot-shrink\.webp$/), phoneShot.tap()]);
    assert.equal(await tab.evaluate(() => document.querySelector('dialog')), null, 'no viewer on a phone');
    await phone.close();

    // No sideways scroll on the page, light and dark.
    for (const colorScheme of ['light', 'dark']) {
      const layout = await browser.newContext({ colorScheme });
      const layoutTab = await layout.newPage();
      for (const width of [1440, 1024, 768, 414, 375, 320]) {
        await layoutTab.setViewportSize({ width, height: 900 });
        await layoutTab.goto(url, { waitUntil: 'networkidle' });
        assert.equal(await layoutTab.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `no sideways scroll at ${width}px (${colorScheme})`);
      }
      await layout.close();
    }
  } finally {
    await browser.close();
  }
  console.log('Product page screenshots passed: links to full size, hover zoom, wide-window viewer (keys, dark area, Back, focus, narrowing), narrow window and phone open the image, reduced motion, layout 1440-320px light and dark.');
})().catch(error => { console.error(error); process.exitCode = 1; });
