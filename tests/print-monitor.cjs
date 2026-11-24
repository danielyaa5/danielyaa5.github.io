const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

// The 3D Print Monitor page: layout at 13 widths, its product bar (also on Support and Privacy), the links that
// matter, and its email sign-up. Sign-ups go through the real function (api/subscribe.js) with a fake Resend API
// in this process, so nothing is sent anywhere and the test sees which Resend topic each address lands on.
// Run: node tests/print-monitor.cjs http://localhost:4173
// Screenshots go to test-results/print-monitor-<width>.png.
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const page3d = `${base}/3d-print-monitor/`;
// 260 and 240 are an iPhone with Safari's page zoom at 150% and 175%.
const widths = [1920, 1440, 1280, 1024, 900, 768, 600, 414, 390, 375, 320, 260, 240];
const endpoint = 'https://danielyakobian.com/api/subscribe/';
const storeLink = 'https://apps.apple.com/app/id6824940843';
const handler = require(path.join(__dirname, '..', 'api', 'subscribe.js'));

// A fake Resend: topics and contacts in memory.
const resend = { topics: [], contacts: new Map(), calls: [] };
function fakeResend() {
  global.fetch = async (url, options = {}) => {
    const { pathname } = new URL(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    resend.calls.push({ method, pathname });
    const reply = (status, data) => new Response(JSON.stringify(data ?? {}), { status });
    if (method === 'GET' && pathname === '/topics') return reply(200, { object: 'list', has_more: false, data: resend.topics });
    if (method === 'POST' && pathname === '/topics') {
      const topic = { id: `topic-${resend.topics.length + 1}`, created_at: new Date().toISOString(), ...body };
      resend.topics.push(topic);
      return reply(201, { id: topic.id });
    }
    const contact = pathname.match(/^\/contacts\/([^/]+)(\/topics)?$/);
    if (contact) {
      const saved = resend.contacts.get(decodeURIComponent(contact[1]));
      if (!saved) return reply(404, { name: 'not_found' });
      if (method === 'PATCH' && contact[2]) body.forEach(item => { saved.topics[item.id] = item.subscription; });
      else if (method === 'PATCH') Object.assign(saved, body);
      return reply(200, {});
    }
    if (method === 'POST' && pathname === '/contacts') {
      resend.contacts.set(body.email, { unsubscribed: body.unsubscribed, topics: Object.fromEntries(body.topics.map(t => [t.id, t.subscription])) });
      return reply(201, {});
    }
    return reply(404, { name: 'not_found' });
  };
}

// Answers the browser's post to the sign-up function by running the function here.
async function runFunction(request, accept) {
  const res = { statusCode: 200, headers: {}, body: '', setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(chunk = '') { this.body += chunk; } };
  await handler({ method: request.method(), body: request.postData() || '', headers: { accept, origin: 'https://danielyakobian.com' } }, res);
  return res;
}

const topicNamed = name => resend.topics.find(topic => topic.name === name);

(async () => {
  await fs.mkdir('test-results', { recursive: true });
  process.env.RESEND_API_KEY = 're_test_key';
  handler.resetCache();
  fakeResend();
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(page3d, { waitUntil: 'networkidle' });
      const layout = await page.evaluate(() => {
        const box = el => el.getBoundingClientRect();
        const frame = box(document.querySelector('.page-frame'));
        const main = box(document.querySelector('main'));
        const signup = document.querySelector('.pm-signup');
        const s = box(signup);
        const hero = document.querySelector('.pm-hero-shot');
        const parts = [...signup.querySelectorAll('h2, p:not(:empty), .signup-email, .signup-button')].filter(el => el.getClientRects().length);
        return {
          sideways: document.documentElement.scrollWidth > innerWidth,
          heroShown: hero.complete && hero.naturalWidth > 0 && box(hero).width > Math.min(200, innerWidth * 0.7) && box(hero).right <= innerWidth,
          heroSrc: hero.currentSrc.split('/').pop(),
          heroInWindow: !!hero.closest('.c-mac') && !!document.querySelector('.c-mac').getClientRects().length,
          heroNote: document.querySelector('.pm-hero-media figcaption')?.textContent,
          homeShot: document.querySelector('.pm-phone img').getAttribute('src').split('/').pop(),
          buttonsFit: [...document.querySelectorAll('.c-hero .c-actions .button')].every(el => box(el).left >= 0 && box(el).right <= innerWidth),
          bar: [...document.querySelectorAll('.cms-nav-links a')].map(a => [a.textContent, a.getAttribute('aria-current')]),
          getInBar: !!document.querySelector('.cms-nav-get'),
          printers: [...document.querySelectorAll('.pm-printer-list b')].map(b => b.textContent),
          signupInMain: s.left >= main.left - 0.5 && s.right <= main.right + 0.5 && s.right <= frame.right,
          spill: parts.filter(el => { const r = box(el); return r.left < s.left - 0.5 || r.right > s.right + 0.5; }).map(el => el.className || el.tagName),
          targets: [...document.querySelectorAll('.signup-email, .signup-button, .c-hero .c-actions .button, .cms-nav-links a')].map(el => ({ name: el.textContent.trim() || el.className, height: box(el).height })),
          topicFields: [...signup.querySelectorAll('input[name="topic"]')].map(el => [el.type, el.value]),
          returnField: signup.querySelector('input[name="return"]')?.value,
          resultsHidden: [...signup.querySelectorAll('.signup-result')].every(el => !el.getClientRects().length),
          emailFont: parseFloat(getComputedStyle(signup.querySelector('.signup-email')).fontSize),
          storeLinks: [...document.querySelectorAll('a[data-store="app_store"]')].map(a => a.href),
          deadLinks: [...document.querySelectorAll('a')].filter(a => /id6824942458/.test(a.href)).length,
          getBox: !!document.getElementById('get'),
          report: !!document.getElementById('report'),
        };
      });
      await page.screenshot({ path: `test-results/print-monitor-${width}.png`, fullPage: true });
      assert.deepEqual(errors, [], `no script errors at ${width}px`);
      assert.equal(layout.sideways, false, `no sideways scroll at ${width}px`);
      assert.ok(layout.heroShown, `the camera widget shows in the hero at ${width}px`);
      // A camera picture leads the page at every width: the Mac app with two printers' camera snapshots, in a dark window.
      assert.match(layout.heroSrc, /^hero-cameras-(900|1600)\.webp$/, `hero picture at ${width}px`);
      assert.ok(layout.heroInWindow, `the hero picture sits in the Mac window at ${width}px`);
      assert.equal(layout.heroNote, 'Sample readings over real camera snapshots.', 'the camera picture says its readings are samples');
      assert.equal(layout.homeShot, 'home-screen-light-600.webp', 'the widgets feature shows the iPhone Home Screen with the camera widget');
      assert.ok(layout.buttonsFit, `hero buttons fit the screen at ${width}px`);
      assert.deepEqual(layout.bar, [['Overview', 'page'], ['Support', null], ['Privacy', null]], 'product bar with Overview marked');
      assert.equal(layout.getInBar, false, 'no Get the app in the product page’s own bar');
      assert.deepEqual(layout.printers, ['Bambu Lab', 'Klipper and Moonraker', 'Creality K1 family', 'OctoPrint', 'PrusaLink', 'Duet and RepRapFirmware', 'Elegoo (SDCP v3)']);
      assert.ok(layout.signupInMain, `sign-up stays in the page column at ${width}px`);
      assert.deepEqual(layout.spill, [], `nothing spills out of the sign-up card at ${width}px`);
      assert.ok(layout.targets.every(t => t.height >= 40), `touch targets are tall enough at ${width}px: ${JSON.stringify(layout.targets)}`);
      assert.ok(layout.targets.filter(t => !/cms-nav|Overview|Support|Privacy/.test(t.name)).every(t => t.height >= 44), `buttons and the email field are at least 44px at ${width}px`);
      assert.deepEqual(layout.topicFields, [['hidden', 'print_monitor']], 'the form sends only the 3D Print Monitor topic');
      assert.equal(layout.returnField, '/3d-print-monitor/');
      assert.ok(layout.resultsHidden, 'no-JavaScript result messages stay hidden');
      assert.ok(layout.emailFont >= 16, 'email field is 16px so iOS does not zoom');
      assert.ok(layout.storeLinks.length >= 2 && layout.storeLinks.every(href => href === storeLink), 'App Store buttons go to the 3D Print Monitor listing');
      assert.equal(layout.deadLinks, 0, 'no links to the removed 3D Print Progress listing');
      assert.ok(layout.getBox && layout.report, 'the #get box and the #report anchor exist');
      await page.close();
    }

    // Support and Privacy carry the same bar, with a way back and Get the app.
    for (const [sub, current] of [['support/', 'Support'], ['privacy/', 'Privacy']]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${page3d}${sub}`, { waitUntil: 'networkidle' });
      const bar = await page.evaluate(() => ({
        current: document.querySelector('.cms-nav-links a[aria-current="page"]')?.textContent,
        home: document.querySelector('.cms-nav-home').getAttribute('href'),
        get: document.querySelector('.cms-nav-get')?.getAttribute('href'),
        sideways: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.deepEqual(bar, { current, home: '../', get: '../#get', sideways: false }, `${sub} product bar`);
      await page.close();
    }

    // Signing up, through the real function: the address lands on the 3D Print Monitor topic only, and this page
    // remembers it under its own key, so the home page's form still shows.
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const posts = [];
      await page.route(endpoint, async route => {
        posts.push(route.request().postData());
        const res = await runFunction(route.request(), 'application/json');
        await route.fulfill({ status: res.statusCode, contentType: 'application/json', headers: { 'access-control-allow-origin': base }, body: res.body });
      });
      const events = [];
      await page.exposeFunction('recordSignupEvent', event => events.push(event));
      await page.addInitScript(() => {
        document.addEventListener('signup', e => window.recordSignupEvent({ type: 'signup', ...e.detail }));
        document.addEventListener('signup-error', e => window.recordSignupEvent({ type: 'signup-error', ...e.detail }));
      });
      await page.goto(`${page3d}#updates`, { waitUntil: 'networkidle' });
      const form = page.locator('.pm-signup .signup-form');
      const status = form.locator('.signup-status');
      // An address the browser accepts but the function doesn't.
      await form.locator('.signup-email').fill('maker@example');
      await form.locator('.signup-button').click();
      await page.waitForFunction(() => document.querySelector('.signup-status').dataset.kind === 'error');
      assert.equal(await status.textContent(), 'That email address doesn’t look right. Check it and try again.');
      assert.ok(await page.evaluate(() => document.activeElement?.matches('.signup-email')), 'focus goes back to the email field');
      const address = `maker-${width}@example.com`;
      await form.locator('.signup-email').fill(address);
      await form.locator('.signup-button').click();
      await page.waitForFunction(() => document.querySelector('.signup-done-message').textContent === 'You’re on the list for new versions.');
      assert.equal(await form.isVisible(), false, 'the form hides after signing up');
      assert.ok(await page.evaluate(() => document.activeElement?.matches('.signup-edit')), 'focus moves to Edit email');
      const sent = new URLSearchParams(posts.at(-1));
      assert.deepEqual([...sent.keys()], ['topic', 'return', 'company', 'email']);
      assert.deepEqual(sent.getAll('topic'), ['print_monitor']);
      const printTopic = topicNamed('3D Print Monitor updates');
      assert.ok(printTopic, 'the function made the 3D Print Monitor topic');
      assert.equal(printTopic.default_subscription, 'opt_out');
      assert.deepEqual(resend.contacts.get(address), { unsubscribed: false, topics: { [printTopic.id]: 'opt_in' } }, 'opted in to 3D Print Monitor updates only');
      assert.deepEqual(events.map(e => [e.type, e.topics, e.error]), [['signup-error', ['print_monitor'], 'invalid_email'], ['signup', ['print_monitor'], undefined]]);
      assert.deepEqual(await page.evaluate(() => ({ mine: JSON.parse(localStorage.getItem('signup-done-3d-print-monitor')), home: localStorage.getItem('signup-done') })), { mine: { topics: ['print_monitor'] }, home: null });
      assert.ok(!(await page.evaluate(() => JSON.stringify({ ...localStorage }))).includes(address), 'the address is never stored');
      if (width === 390) await page.locator('.pm-signup').screenshot({ path: 'test-results/print-monitor-signup-done-390.png' });
      // It stays one line after a reload; the home page's sign-up is untouched.
      await page.reload({ waitUntil: 'networkidle' });
      assert.ok(await page.locator('.pm-signup.is-done').isVisible(), 'still one line after a reload');
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      assert.ok(await page.locator('.signup-form').isVisible(), 'the home page form still shows');
      await page.goto(page3d, { waitUntil: 'networkidle' });
      await page.locator('.pm-signup .signup-edit').click();
      assert.ok(await form.isVisible(), 'Edit email shows the form again');
      assert.equal(await page.evaluate(() => localStorage.getItem('signup-done-3d-print-monitor')), null);
      await context.close();
    }

    // Without JavaScript the function sends the browser back to this page's message, not the home page's.
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    let location = '';
    await page.route(endpoint, async route => {
      const res = await runFunction(route.request(), 'text/html');
      location = res.headers.location;
      await route.fulfill({ status: res.statusCode, headers: { location: location.replace('https://danielyakobian.com', base) } });
    });
    await page.goto(page3d);
    await page.locator('.pm-signup .signup-email').fill('nojs@example.com');
    await page.locator('.pm-signup .signup-button').click();
    await page.waitForURL(`${page3d}#signup-thanks`);
    assert.equal(location, 'https://danielyakobian.com/3d-print-monitor/#signup-thanks');
    assert.ok(await page.locator('#signup-thanks').isVisible(), 'thank-you message shows without JavaScript');
    assert.deepEqual(Object.values(resend.contacts.get('nojs@example.com').topics), ['opt_in']);
    await page.goto(`${page3d}#signup-failed`);
    assert.ok(await page.locator('#signup-failed').isVisible(), 'failure message shows without JavaScript');
    await context.close();

    // Dark mode keeps the dark window and swaps in the dark Home Screen.
    for (const [width, hero] of [[1280, /hero-cameras-(900|1600)\.webp$/], [390, /hero-cameras-(900|1600)\.webp$/]]) {
      const dark = await browser.newPage({ colorScheme: 'dark', viewport: { width, height: 900 } });
      await dark.goto(page3d, { waitUntil: 'networkidle' });
      assert.match(await dark.locator('.pm-hero-shot').evaluate(img => img.currentSrc), hero, `dark hero at ${width}px`);
      await dark.locator('.pm-phone img').scrollIntoViewIfNeeded();
      await dark.waitForFunction(() => document.querySelector('.pm-phone img').complete);
      assert.match(await dark.locator('.pm-phone img').evaluate(img => img.currentSrc), /home-screen-dark-600\.webp$/);
      await dark.screenshot({ path: `test-results/print-monitor-${width}-dark.png`, fullPage: true });
      await dark.close();
    }
    assert.ok(resend.calls.every(call => call.pathname.startsWith('/topics') || call.pathname.startsWith('/contacts')), 'only the fake Resend was called');
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ passed: true, widths }));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
