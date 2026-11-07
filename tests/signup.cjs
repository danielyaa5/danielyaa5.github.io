const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');

// The email sign-up under Featured projects: placement, fit and touch targets at 12 widths,
// then the form's behaviour against a fake sign-up function (nothing is sent anywhere).
// Run: node tests/signup.cjs http://localhost:4173
// Screenshots of the section go to test-results/signup-<width>.png.
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const widths = [1920, 1650, 1440, 1280, 1024, 900, 820, 768, 600, 414, 390, 375, 320];
const endpoint = 'https://danielyakobian.com/api/subscribe/';

(async () => {
  await fs.mkdir('test-results', { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      const layout = await page.evaluate(() => {
        const box = el => el.getBoundingClientRect();
        const signup = document.querySelector('.signup');
        const featured = document.querySelector('.featured-projects');
        const other = document.querySelector('.other-projects-title');
        const frame = box(document.querySelector('.page-frame'));
        const grid = box(document.querySelector('.featured-grid'));
        const s = box(signup);
        const parts = [...signup.querySelectorAll('h2, p:not(:empty), .signup-topic, .signup-email, .signup-button, legend')].filter(el => el.getClientRects().length);
        const inner = box(signup);
        const targets = [...signup.querySelectorAll('.signup-topic, .signup-email, .signup-button')].map(el => ({ name: el.textContent.trim().slice(0, 30) || el.className, height: box(el).height, width: box(el).width }));
        const note = signup.querySelector('[value="beta"] + span .signup-topic-note');
        const betaNote = { text: note.textContent, bold: note.querySelector('strong')?.textContent, weight: getComputedStyle(note.querySelector('strong')).fontWeight };
        const topicLabels = [...signup.querySelectorAll('.signup-topic-name')].map(el => el.textContent);
        return {
          order: featured.compareDocumentPosition(signup) & Node.DOCUMENT_POSITION_FOLLOWING && signup.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING,
          below: s.top >= box(featured).bottom - 1 && s.bottom <= box(other).top,
          alignedLeft: Math.abs(s.left - grid.left) < 1,
          alignedRight: Math.abs(s.right - grid.right) < 1,
          inFrame: s.left >= frame.left && s.right <= frame.right,
          spill: parts.filter(el => { const r = box(el); return r.left < inner.left - 0.5 || r.right > inner.right + 0.5; }).map(el => el.className || el.tagName),
          sideways: document.documentElement.scrollWidth > innerWidth,
          targets,
          topicLabels,
          betaNote,
          checked: [...signup.querySelectorAll('input[type="checkbox"]')].filter(el => el.checked).length,
          trapVisible: (() => { const r = box(signup.querySelector('.signup-trap')); return r.right > 0 && r.left < innerWidth && r.width > 2; })(),
          emailFont: parseFloat(getComputedStyle(signup.querySelector('.signup-email')).fontSize),
          resultsHidden: [...signup.querySelectorAll('.signup-result')].every(el => !el.getClientRects().length),
        };
      });
      await page.locator('.signup').screenshot({ path: `test-results/signup-${width}.png` });

      // The one-line state after signing up, as a returning visitor sees it.
      await page.evaluate(() => localStorage.setItem('signup-done', JSON.stringify({ topics: ['beta'] })));
      await page.reload({ waitUntil: 'networkidle' });
      const compact = await page.evaluate(() => {
        const box = el => el.getBoundingClientRect();
        const signup = document.querySelector('.signup');
        const s = box(signup);
        const text = box(signup.querySelector('.signup-done-text'));
        const edit = box(signup.querySelector('.signup-edit'));
        const grid = box(document.querySelector('.featured-grid'));
        return {
          height: s.height,
          oneRow: Math.abs((text.top + text.bottom) / 2 - (edit.top + edit.bottom) / 2) < 2,
          inside: [text, edit].every(r => r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom),
          aligned: Math.abs(s.left - grid.left) < 1 && Math.abs(s.right - grid.right) < 1,
          editHeight: edit.height,
          formShown: !!document.querySelector('.signup-form').getClientRects().length,
          sideways: document.documentElement.scrollWidth > innerWidth,
        };
      });
      await page.locator('.signup').screenshot({ path: `test-results/signup-done-${width}.png` });
      assert.equal(compact.formShown, false, `form hidden after signing up at ${width}px`);
      assert.ok(compact.inside && compact.aligned, `success row fits its card and lines up at ${width}px`);
      assert.ok(compact.editHeight >= 44, `Edit email is at least 44px tall at ${width}px`);
      assert.ok(width < 360 || (compact.oneRow && compact.height <= 72), `success row is one short line at ${width}px: ${JSON.stringify(compact)}`);
      assert.ok(compact.height <= 120, `success row stays small at ${width}px`);
      assert.equal(compact.sideways, false);
      assert.ok(layout.order, `sign-up sits between Featured projects and Other projects at ${width}px`);
      assert.ok(layout.below, `sign-up shows below the featured tiles at ${width}px`);
      assert.ok(layout.alignedLeft && layout.alignedRight, `sign-up lines up with the featured tiles at ${width}px`);
      assert.ok(layout.inFrame, `sign-up stays in the frame at ${width}px`);
      assert.deepEqual(layout.spill, [], `nothing spills out of the sign-up card at ${width}px`);
      assert.equal(layout.sideways, false, `no sideways scroll at ${width}px`);
      assert.ok(layout.targets.every(t => t.height >= 44), `touch targets are at least 44px tall at ${width}px: ${JSON.stringify(layout.targets)}`);
      assert.deepEqual(layout.topicLabels, ['Beta tester invites', 'New app and open source launches', 'Promos']);
      assert.deepEqual(layout.betaNote, { text: 'Try apps early and get them free for life!', bold: 'free for life!', weight: '700' }, 'beta note with "free for life!" in bold');
      assert.equal(layout.checked, 0, 'no box is ticked in advance');
      assert.equal(layout.trapVisible, false, 'the bot trap field is off screen');
      assert.ok(layout.emailFont >= 16, 'email field is 16px so iOS does not zoom');
      assert.ok(layout.resultsHidden, 'no-JavaScript result messages stay hidden');
      await page.close();
    }

    // Behaviour, at phone, tablet and desktop widths.
    for (const width of [390, 820, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const posts = [];
      let reply = { status: 200, body: { ok: true } };
      await page.route(endpoint, async route => {
        const request = route.request();
        posts.push({ method: request.method(), body: request.postData(), type: request.headers()['content-type'], accept: request.headers().accept });
        if (reply === 'abort') return route.abort();
        await route.fulfill({ status: reply.status, contentType: 'application/json', headers: { 'access-control-allow-origin': base }, body: JSON.stringify(reply.body) });
      });
      const events = [];
      await page.exposeFunction('recordSignupEvent', event => events.push(event));
      await page.addInitScript(() => {
        document.addEventListener('signup', e => window.recordSignupEvent({ type: 'signup', ...e.detail }));
        document.addEventListener('signup-error', e => window.recordSignupEvent({ type: 'signup-error', ...e.detail }));
      });
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      const form = page.locator('.signup-form');
      const status = form.locator('.signup-status');

      // An empty address is stopped by the browser; no ticked box is stopped by the page.
      await form.locator('.signup-button').click();
      assert.equal(posts.length, 0, 'empty address is not sent');
      await form.locator('.signup-email').fill('reader@example.com');
      await form.locator('.signup-button').click();
      assert.equal(await status.textContent(), 'Pick at least one kind of email.');
      assert.equal(await status.getAttribute('data-kind'), 'error');
      assert.equal(posts.length, 0, 'nothing is sent without a topic');
      // Clicking the description text ticks the box too.
      await form.locator('.signup-topic', { hasText: 'Beta tester invites' }).locator('.signup-topic-note').click();
      assert.equal(await status.textContent(), '', 'error clears once a box is ticked');
      await form.getByLabel(/New app and open source launches/).check();

      await form.locator('.signup-button').click();
      // Success shrinks the section to one line with an Edit email button, which takes focus.
      await page.waitForFunction(() => document.querySelector('.signup-done-message').textContent === 'Signup success!');
      assert.equal((await page.locator('.signup-done-text').textContent()).trim(), '✓ Signup success!');
      assert.equal(await form.isVisible(), false, 'the form hides after signing up');
      assert.equal(await page.locator('.signup-intro').isVisible(), false, 'the intro hides after signing up');
      assert.ok(await page.evaluate(() => document.activeElement?.matches('.signup-edit')), 'focus moves to Edit email');
      assert.equal(await form.locator('.signup-email').inputValue(), '', 'address is cleared after signing up');
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('signup-done'))), { topics: ['beta', 'new_apps'] }, 'only the ticked topics are remembered');
      assert.ok(!(await page.evaluate(() => JSON.stringify({ ...localStorage }))).includes('reader@example.com'), 'the address is never stored');
      // It stays small on the next visit, and Edit email brings the form back with the same boxes ticked.
      await page.reload({ waitUntil: 'networkidle' });
      assert.ok(await page.locator('.signup.is-done').isVisible(), 'still one line after a reload');
      assert.equal(await form.isVisible(), false);
      await page.locator('.signup-edit').click();
      assert.ok(await form.isVisible(), 'Edit email shows the form again');
      assert.ok(await page.locator('.signup-intro').isVisible());
      assert.equal(await page.locator('.signup-done').isVisible(), false);
      assert.deepEqual(await form.locator('input[name="topic"]:checked').evaluateAll(boxes => boxes.map(box => box.value)), ['beta', 'new_apps']);
      assert.ok(await page.evaluate(() => document.activeElement?.matches('.signup-email')), 'focus goes to the email field');
      assert.equal(await page.evaluate(() => localStorage.getItem('signup-done')), null, 'editing forgets the saved state');
      assert.equal(posts.length, 1);
      assert.equal(posts[0].method, 'POST');
      assert.match(posts[0].type, /^application\/x-www-form-urlencoded/, 'form-encoded, so no preflight is needed cross-origin');
      assert.equal(posts[0].accept, 'application/json');
      const sent = new URLSearchParams(posts[0].body);
      assert.deepEqual(sent.getAll('topic'), ['beta', 'new_apps']);
      assert.equal(sent.get('email'), 'reader@example.com');
      assert.equal(sent.get('company'), '');
      assert.deepEqual(events, [{ type: 'signup', topics: ['beta', 'new_apps'] }]);

      // Error replies are explained, and the button comes back (the form is open again after Edit email).
      for (const [next, text] of [
        [{ status: 503, body: { ok: false, error: 'not_configured' } }, 'Sign-ups aren’t open yet. To get on the list now, write to support@danielyakobian.com.'],
        [{ status: 400, body: { ok: false, error: 'invalid_email' } }, 'That email address doesn’t look right. Check it and try again.'],
        [{ status: 502, body: { ok: false, error: 'provider_error' } }, 'That didn’t go through. Try again in a minute, or write to support@danielyakobian.com.'],
        ['abort', 'That didn’t go through. Try again in a minute, or write to support@danielyakobian.com.'],
      ]) {
        reply = next;
        await form.locator('.signup-email').fill('reader@example.com');
        await form.locator('.signup-button').click();
        await page.waitForFunction(() => document.querySelector('.signup-status').dataset.kind === 'error');
        assert.equal(await status.textContent(), text);
        assert.equal(await form.locator('.signup-button').isDisabled(), false);
        await page.evaluate(() => { document.querySelector('.signup-status').dataset.kind = ''; });
      }
      assert.deepEqual(events.slice(1).map(e => e.error), ['not_configured', 'invalid_email', 'provider_error', 'network']);
      if (width === 390) await page.locator('.signup').screenshot({ path: 'test-results/signup-error-390.png' });
      await page.close();
    }

    // Without JavaScript the form posts straight to the function, which sends the browser back to a message.
    // Reduced motion turns off smooth scrolling, which Playwright's no-JavaScript clicks wait on.
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    let posted = null;
    await page.route(endpoint, route => { posted = route.request().postData(); return route.fulfill({ status: 303, headers: { location: `${base}/#signup-thanks` } }); });
    await page.goto(`${base}/`);
    await page.getByLabel(/Promos/).check();
    await page.locator('.signup-email').fill('reader@example.com');
    await page.locator('.signup-button').click();
    await page.waitForURL(`${base}/#signup-thanks`);
    assert.deepEqual(new URLSearchParams(posted).getAll('topic'), ['promos']);
    assert.ok(await page.locator('#signup-thanks').isVisible(), 'thank-you message shows without JavaScript');
    assert.ok(!(await page.locator('#signup-failed').isVisible()));
    await page.goto(`${base}/#signup-failed`);
    assert.ok(await page.locator('#signup-failed').isVisible(), 'failure message shows without JavaScript');
    await context.close();
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ passed: true, widths }));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
