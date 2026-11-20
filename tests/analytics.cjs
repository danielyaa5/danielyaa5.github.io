const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium } = require('playwright');

// Analytics must stay silent on local previews, skip the guest gate, and send only origin + path.
// The published host is simulated by answering its requests from the local server; PostHog's
// capture requests are intercepted and never leave the machine. POSTHOG_ARRAY_JS can point at a
// local copy of PostHog's array.js when its CDN is unreachable.
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const root = path.join(__dirname, '..');
const site = 'http://danielyakobian.com';
const tracked = ['index.html', 'blog/index.html', 'quickdesk/index.html', 'resume/index.html', 'motorcycle-rentals/index.html', 'cloud-media-shrinker/index.html', 'cloud-media-shrinker/privacy/index.html',
  'beckon/index.html', 'beckon/privacy/index.html', 'beckon/terms/index.html', '3d-print-monitor/index.html', '3d-print-monitor/privacy/index.html', '3d-print-monitor/support/index.html', 'tagtracker/index.html', 'puml-for-markdown/index.html',
  ...fs.readdirSync(path.join(root, 'blog')).filter(name => name.endsWith('.html') && name !== 'index.html').map(name => `blog/${name}`)];
const untracked = ['gate/index.html', 'quickdesk/privacy.html', 'bubcal/index.html', 'bubcal/astra-v1/index.html', 'bubcal/astra-v2/index.html'];

const events = request => {
  const raw = request.postDataBuffer();
  if (!raw) return [];
  let text = raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw).toString() : raw.toString();
  if (text.startsWith('data=')) text = Buffer.from(decodeURIComponent(text.slice(5)), 'base64').toString();
  else if (!/^\s*[\[{]/.test(text)) text = Buffer.from(text, 'base64').toString();
  const body = JSON.parse(text);
  return Array.isArray(body) ? body : body.batch || [body];
};

(async () => {
  for (const file of tracked) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(html.match(/<script src="\/analytics\.js\?v=14" defer><\/script>/g)?.length, 1, `${file} loads analytics v=14 once`);
  }
  // vercel.json sends /dy-relay/ to PostHog. The site-wide trailing slash turns /array/<token>/config into .../config/,
  // which PostHog answers with a 404, so a rule ahead of the general one strips that slash again.
  const rewrites = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).rewrites;
  const rewriteAt = source => rewrites.findIndex(rule => rule.source === source);
  assert.ok(rewriteAt('/dy-relay/array/:path(.*)/') >= 0 && rewriteAt('/dy-relay/array/:path(.*)/') < rewriteAt('/dy-relay/array/:path(.*)'), 'the relay strips the trailing slash from PostHog remote config');
  for (const file of untracked) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /analytics\.js/, `${file} has no analytics`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'analytics.js'), 'utf8'), /POSTHOG_PROJECT_TOKEN/, 'analytics.js has the project token');

  // The routes below stand in for the published site and PostHog, but beacons sent while a page closes can slip past them.
  // Unresolvable hosts make those fail instead of landing in the real PostHog project.
  const browser = await chromium.launch({
    headless: true,
    args: ['--host-resolver-rules=MAP danielyakobian.com ~NOTFOUND, MAP *.danielyakobian.com ~NOTFOUND, MAP *.posthog.com ~NOTFOUND'],
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  });
  try {
    // Local preview: PostHog is never contacted.
    const local = await browser.newPage();
    const analytics = [];
    local.on('request', r => { const url = new URL(r.url()); if (url.hostname.endsWith('posthog.com') || url.pathname.startsWith('/dy-relay/')) analytics.push(r.url()); });
    await local.goto(`${base}/`, { waitUntil: 'networkidle' });
    assert.deepEqual(analytics, [], 'local preview sends no analytics');
    await local.close();

    // Automated / headless / bot browsers on the published host must never load or contact PostHog.
    const botCases = [
      { label: 'default headless', contextOptions: {}, init: null },
      {
        label: 'webdriver=true with regular UA',
        contextOptions: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36' },
        init: () => {
          Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => true });
          Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
        },
      },
      {
        label: 'bot userAgent with webdriver=false',
        contextOptions: { userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
        init: () => {
          Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
          Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
        },
      },
      {
        label: 'HeadlessChrome brand in userAgentData',
        contextOptions: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36' },
        init: () => {
          Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
          Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => ({ brands: [{ brand: 'HeadlessChrome', version: '142' }] }) });
        },
      },
    ];
    await Promise.all(botCases.map(async ({ label, contextOptions, init }) => {
      const botContext = await browser.newContext(contextOptions);
      try {
        if (init) await botContext.addInitScript(init);
        const posthogRequests = [];
        await botContext.route(`${site}/**`, async route => {
          const url = new URL(route.request().url());
          const response = await fetch(base + url.pathname);
          await route.fulfill({ status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'text/html' }, body: Buffer.from(await response.arrayBuffer()) });
        });
        await botContext.route(/^https:\/\/us(-assets)?\.i\.posthog\.com\/.*/, async route => {
          posthogRequests.push(route.request().url());
          await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
        });
        // The site's own PostHog relay (vercel.json rewrites /dy-relay/ to PostHog) counts as contacting PostHog too.
        await botContext.route(`${site}/dy-relay/**`, async route => {
          posthogRequests.push(route.request().url());
          await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
        });
        const botPage = await botContext.newPage();
        await botPage.goto(`${site}/`, { waitUntil: 'networkidle' });
        await botPage.waitForTimeout(2300);
        const hasPosthog = await botPage.evaluate(() => Boolean(window.posthog || document.querySelector('script[src*="posthog"], script[src*="/dy-relay/"]')));
        assert.deepEqual(posthogRequests, [], `${label} sends no PostHog requests`);
        assert.equal(hasPosthog, false, `${label} never loads PostHog`);
      } finally {
        await botContext.close();
      }
    }));

    // Published host: serve the site locally and catch what PostHog would receive.
    // PostHog ignores headless and automated browsers, so this one presents as a regular Chrome.
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36' });
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
    });
    const captured = [];
    await context.route(`${site}/**`, async route => {
      const url = new URL(route.request().url());
      const response = await fetch(base + url.pathname);
      await route.fulfill({ status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'text/html' }, body: Buffer.from(await response.arrayBuffer()) });
    });
    // On the published host, PostHog goes through the site's /dy-relay/ path, which vercel.json rewrites to PostHog.
    // Here PostHog's scripts come from PostHog (or a local copy in POSTHOG_ARRAY_JS) and everything else is caught.
    const relayScript = /^\/dy-relay\/static\/(?:[\d.]+\/)?(array|web-vitals[\w-]*|exception-autocapture)\.js$/;
    await context.route(`${site}/dy-relay/**`, async route => {
      const url = new URL(route.request().url());
      const script = url.pathname.match(relayScript);
      if (script) {
        if (process.env.POSTHOG_ARRAY_JS) {
          // The web vitals script sits beside array.js in PostHog's package (dist/web-vitals*.js).
          const file = script[1] === 'array' ? process.env.POSTHOG_ARRAY_JS : path.join(path.dirname(process.env.POSTHOG_ARRAY_JS), `${script[1]}.js`);
          return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(file) });
        }
        const response = await fetch(`https://us-assets.i.posthog.com${url.pathname.slice('/dy-relay'.length)}`);
        return route.fulfill({ status: response.status, contentType: 'application/javascript', body: Buffer.from(await response.arrayBuffer()) });
      }
      // The project's remote settings (public, keyed by the token) come from PostHog too, as on the live site:
      // PostHog starts click autocapture only once they say autocapture is allowed.
      if (/^\/dy-relay\/array\/[^/]+\/config\/?$/.test(url.pathname)) {
        const response = await fetch(`https://us-assets.i.posthog.com${url.pathname.replace(/\/$/, '').slice('/dy-relay'.length)}`);
        return route.fulfill({ status: response.status, contentType: 'application/json', body: Buffer.from(await response.arrayBuffer()) });
      }
      if (route.request().method() === 'POST' && /\/e\/|\/i\/v0\/e\//.test(url.pathname)) captured.push(...events(route.request()));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
    });
    // Nothing on the published host should reach PostHog's own domains, where ad blockers would stop it.
    const direct = [];
    await context.route(/^https:\/\/us(-assets)?\.i\.posthog\.com\//, async route => {
      direct.push(route.request().url());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
    });

    const page = await context.newPage();
    await page.goto(`${site}/?utm_source=analytics-test#private-fragment`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.posthog?.__loaded === true);
    await page.evaluate(() => window.posthog.flush?.());
    await page.waitForTimeout(1500);
    const views = captured.filter(e => e.event === '$pageview');
    assert.equal(views.length, 1, 'one page view');
    assert.deepEqual(direct, [], 'the published host reaches PostHog only through /dy-relay/');
    const props = views[0].properties;
    assert.equal(props.$current_url, `${site}/`, 'query and fragment are removed');
    assert.equal(props.utm_source, 'analytics-test', 'campaign tags survive as their own property');
    assert.equal(props.$cookieless_mode, true, 'cookieless mode');
    assert.ok(!JSON.stringify(captured).includes('private-fragment'), 'fragment never sent');
    assert.deepEqual(await context.cookies(), [], 'no cookies');
    assert.deepEqual(await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter(key => /ph_|posthog/i.test(key))), [], 'no PostHog storage');

    // Page speed: a click gives an interaction, and hiding the page sends the web vitals gathered so far,
    // with this site's addresses cleaned inside each metric too.
    await page.locator('.hero h1').click();
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(1500);
    const vitals = captured.filter(e => e.event === '$web_vitals');
    assert.ok(vitals.length >= 1, 'web vitals are sent');
    const metrics = Object.assign({}, ...vitals.map(e => e.properties));
    for (const name of ['FCP', 'LCP']) {
      assert.equal(typeof metrics[`$web_vitals_${name}_value`], 'number', `${name} is measured`);
      assert.equal(metrics[`$web_vitals_${name}_event`].$current_url, `${site}/`, `${name} address is cleaned`);
    }
    assert.ok(vitals.every(e => e.properties.$current_url === `${site}/` && e.properties.$cookieless_mode === true), 'cookieless web vitals with a clean address');
    assert.ok(!/utm_source=|private-fragment/.test(JSON.stringify(vitals)), 'no query or fragment inside web vitals');

    // Browser errors become $exception events: one thrown before PostHog has loaded (it waits for the load event),
    // one after, and an unhandled promise rejection, each sent once with the page address cleaned.
    const errorPage = await context.newPage();
    await errorPage.addInitScript(() => addEventListener('DOMContentLoaded', () => setTimeout(() => { throw new Error('analytics-test early error'); }, 0)));
    const errorStart = captured.length;
    await errorPage.goto(`${site}/blog/?utm_source=analytics-test#private-fragment`, { waitUntil: 'networkidle' });
    await errorPage.waitForFunction(() => window.posthog?.__loaded === true);
    await errorPage.evaluate(() => {
      setTimeout(() => { throw new Error('analytics-test late error'); }, 0);
      Promise.reject(new Error('analytics-test rejection'));
    });
    // PostHog batches $exception events (about every 3 s), so wait for the batch, then a little longer to catch any duplicate.
    const errorsSoFar = () => captured.slice(errorStart).filter(e => e.event === '$exception');
    for (let i = 0; i < 40 && errorsSoFar().length < 3; i += 1) await errorPage.waitForTimeout(200);
    await errorPage.waitForTimeout(500);
    const exceptions = errorsSoFar();
    assert.deepEqual(exceptions.map(e => e.properties.$exception_list?.[0]?.value).sort(), ['analytics-test early error', 'analytics-test late error', 'analytics-test rejection'], `each error is sent once; got ${JSON.stringify(captured.slice(errorStart).map(e => [e.event, e.properties.$current_url, e.properties.$exception_list?.[0]?.value]))}`);
    assert.deepEqual(exceptions.map(e => e.properties.error_source).sort(), ['uncaught', 'uncaught', 'unhandled_rejection'], 'error source is recorded');
    assert.ok(exceptions.every(e => e.properties.$current_url === `${site}/blog/` && e.properties.$cookieless_mode === true), 'cookieless errors with a clean address');
    assert.ok(!/utm_source=|private-fragment/.test(JSON.stringify(exceptions)), 'no query or fragment inside errors');
    await errorPage.close();

    // 3 quick clicks in one spot on any element (here the hero title, which isn't a link) send one $rageclick naming it,
    // clicks on interactive elements beyond links (a filter button) are autocaptured, and clicking into the sign-up field
    // never sends what was typed there. All with a clean address.
    const ragePage = await context.newPage();
    const rageStart = captured.length;
    await ragePage.goto(`${site}/?utm_source=analytics-test#private-fragment`, { waitUntil: 'networkidle' });
    await ragePage.waitForFunction(() => window.posthog?.__loaded === true);
    const heroTitle = await ragePage.locator('.hero h1').boundingBox();
    for (let i = 0; i < 4; i += 1) await ragePage.mouse.click(heroTitle.x + heroTitle.width / 2, heroTitle.y + heroTitle.height / 2, { delay: 20 });
    await ragePage.locator('[data-filter="web"]').click();
    await ragePage.locator('.signup-email').fill('analytics-test-typed@example.com');
    await ragePage.locator('.signup-email').click();
    // PostHog batches autocaptured clicks (about every 3 s), so wait for the batch.
    const sinceRage = () => captured.slice(rageStart);
    const autoClicks = () => sinceRage().filter(e => e.event === '$autocapture' && e.properties.$event_type === 'click');
    for (let i = 0; i < 40 && !autoClicks().some(e => /(^|;)button[.:]/.test(e.properties.$elements_chain || '')); i += 1) await ragePage.waitForTimeout(200);
    await ragePage.waitForTimeout(500);
    const rage = sinceRage().filter(e => e.event === '$rageclick');
    assert.equal(rage.length, 1, `one rage click for a burst of 4; got ${JSON.stringify(sinceRage().map(e => e.event))}`);
    assert.match(rage[0].properties.element || '', /^h1\b/, 'the rage click names the clicked element');
    assert.ok(autoClicks().some(e => /(^|;)button[.:]/.test(e.properties.$elements_chain || '')), 'a click on a filter button is autocaptured');
    assert.ok([...rage, ...autoClicks()].every(e => e.properties.$current_url === `${site}/` && e.properties.$cookieless_mode === true), 'cookieless clicks with a clean address');
    assert.ok(!/utm_source=|private-fragment|analytics-test-typed/.test(JSON.stringify(sinceRage())), 'no query, fragment or typed text in click events');
    await ragePage.close();

    // Links in project tiles send a project_click named after the project, at phone, tablet and desktop widths.
    // Navigation is cancelled after the site's own listeners run, so the page stays put.
    context.on('page', async popup => { if (await popup.opener()) await popup.close().catch(() => {}); });
    for (const width of [390, 820, 1440]) {
      const tiles = await context.newPage();
      await tiles.setViewportSize({ width, height: 900 });
      await tiles.goto(`${site}/`, { waitUntil: 'networkidle' });
      await tiles.waitForFunction(() => window.posthog?.__loaded === true);
      await tiles.evaluate(() => {
        for (const type of ['click', 'auxclick']) window.addEventListener(type, event => { if (event.target.closest?.('a[href]')) event.preventDefault(); });
      });
      const start = captured.length;
      await tiles.locator('.featured-lead .featured-link').click();
      await tiles.locator('.featured-pick').nth(1).locator('.project-name').click({ button: 'middle' });
      // A click on the tile's description lands on the title link's stretched layer and counts as `tile`.
      const buyOrRentP = tiles.locator('.featured-pick').nth(2).locator('.featured-copy > p');
      await buyOrRentP.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const buyOrRentBox = await buyOrRentP.boundingBox();
      await tiles.mouse.click(buyOrRentBox.x + buyOrRentBox.width / 2, buyOrRentBox.y + buyOrRentBox.height / 2);
      await tiles.locator('[data-filter="web"]').click();
      await tiles.locator('#project-list .project', { hasText: 'Netflix PiP Fixer' }).locator('.project-link').click();
      await tiles.locator('#project-list .project', { hasText: 'H2D Custom Dashboard' }).locator('.project-benefit').click({ force: true, button: 'middle' });
      await tiles.locator('[data-filter="ios"]').click();
      await tiles.locator('#project-list .project', { hasText: 'Cloud Media Shrinker' }).locator('.project-benefit').click({ force: true });
      await tiles.locator('.hero-actions a', { hasText: 'GitHub' }).click();
      await tiles.waitForTimeout(1500);
      const clicks = captured.slice(start).filter(e => e.event === 'project_click').map(e => e.properties);
      const pick = ({ project, link, link_text, destination, section, position, filter }) => ({ project, link, link_text, destination, section, position, filter });
      assert.deepEqual(clicks.map(pick), [
        { project: 'Cloud Media Shrinker', link: 'button', link_text: 'View on the App Store →', destination: 'https://apps.apple.com/app/cloud-media-shrinker/id6824383256?pt=125201749&ct=portfolio_featured&mt=8', section: 'featured', position: 1, filter: undefined },
        { project: 'puml-for-markdown', link: 'title', link_text: 'puml-for-markdown', destination: 'https://danielyakobian.com/puml-for-markdown/', section: 'featured', position: 2, filter: undefined },
        { project: 'Buy or Rent', link: 'tile', link_text: 'Buy or Rent', destination: 'https://thebuyorrentcalculator.com/', section: 'featured', position: 3, filter: undefined },
        { project: 'Netflix PiP Fixer', link: 'button', link_text: 'Get it on the Chrome Web Store →', destination: 'https://chromewebstore.google.com/detail/netflix-pip-fixer/ceiiadpnmbplofcefdafhfidmocjgikp', section: 'other', position: 5, filter: 'web' },
        { project: 'H2D Custom Dashboard', link: 'tile', link_text: 'H2D Custom Dashboard', destination: 'https://danielyakobian.com/blog/h2d-exhaust-fan.html', section: 'other', position: 11, filter: 'web' },
        { project: 'Cloud Media Shrinker', link: 'tile', link_text: 'Cloud Media Shrinker', destination: 'https://danielyakobian.com/cloud-media-shrinker/', section: 'other', position: 1, filter: 'ios' },
      ], `project clicks at ${width}px; links outside the tiles send none`);
      assert.ok(clicks.every(props => props.$cookieless_mode === true && props.$current_url === `${site}/`), `cookieless project clicks at ${width}px`);
      await tiles.close();
    }

    // Booking links on the motorcycle rentals page send a rental_click named after the bike and the site.
    for (const width of [390, 820, 1440]) {
      const rentals = await context.newPage();
      await rentals.setViewportSize({ width, height: 900 });
      await rentals.goto(`${site}/motorcycle-rentals/`, { waitUntil: 'networkidle' });
      await rentals.waitForFunction(() => window.posthog?.__loaded === true);
      await rentals.evaluate(() => {
        for (const type of ['click', 'auxclick']) window.addEventListener(type, event => { if (event.target.closest?.('a[href]')) event.preventDefault(); });
      });
      const expected = await rentals.locator('.rentals a[data-platform]').evaluateAll(links => links.map(a => {
        const bike = a.closest('.bike');
        return { bike: bike ? bike.querySelector('h3').textContent.trim() : 'All bikes', platform: a.dataset.platform, link_text: a.textContent.replace(/\s+/g, ' ').trim(), destination: a.href, position: bike ? [...document.querySelectorAll('.bike')].indexOf(bike) + 1 : 0 };
      }));
      assert.ok(expected.filter(e => e.position > 0).length >= 2, 'the rentals page has booking links');
      const start = captured.length;
      const links = rentals.locator('.rentals a[data-platform]');
      for (let i = 0; i < expected.length; i++) await links.nth(i).click({ button: i % 2 ? 'middle' : 'left' });
      await rentals.locator('.site-header nav a', { hasText: 'Work' }).click();
      await rentals.waitForTimeout(1500);
      const sent = captured.slice(start).filter(e => e.event === 'rental_click').map(e => e.properties);
      const pick = ({ bike, platform, link_text, destination, position }) => ({ bike, platform, link_text, destination, position });
      assert.deepEqual(sent.map(pick), expected, `rental clicks at ${width}px; other links send none`);
      assert.ok(sent.every(props => props.$cookieless_mode === true && props.$current_url === `${site}/motorcycle-rentals/`), `cookieless rental clicks at ${width}px`);
      await rentals.close();
    }

    // Each resume PDF button sends a resume_download named after the button; other links on the page send none.
    for (const width of [390, 820, 1440]) {
      const resume = await context.newPage();
      await resume.setViewportSize({ width, height: 900 });
      await resume.goto(`${site}/resume/`, { waitUntil: 'networkidle' });
      await resume.waitForFunction(() => window.posthog?.__loaded === true);
      await resume.evaluate(() => {
        for (const type of ['click', 'auxclick']) window.addEventListener(type, event => { if (event.target.closest?.('a[href]')) event.preventDefault(); });
      });
      const start = captured.length;
      await resume.locator('.r-hero .download').click();
      await resume.locator('.r-hero a', { hasText: 'LinkedIn' }).click();
      await resume.locator('.end-cta .button').scrollIntoViewIfNeeded();
      await resume.waitForSelector('.scroll-bar.is-shown');
      await resume.locator('.scroll-download').click({ button: 'middle' });
      await resume.locator('.end-cta .button').click();
      await resume.waitForTimeout(1500);
      const pdf = `${site}/assets/Daniel_Yakobian_Resume.pdf`;
      const sent = captured.slice(start).filter(e => e.event === 'resume_download').map(e => e.properties);
      assert.deepEqual(sent.map(({ button, link_text, destination }) => ({ button, link_text, destination })), [
        { button: 'top', link_text: 'Download PDF 1 page · 29 KB', destination: pdf },
        { button: 'scroll_bar', link_text: await resume.locator('.scroll-download').evaluate(a => a.textContent.replace(/\s+/g, ' ').trim()), destination: pdf },
        { button: 'end', link_text: 'Download PDF resume', destination: pdf },
      ], `resume downloads at ${width}px; other links send none`);
      assert.ok(sent.every(props => props.$cookieless_mode === true && props.$current_url === `${site}/resume/`), `cookieless resume downloads at ${width}px`);
      await resume.close();
    }

    // Download buttons on app pages send app_download_click naming the app, store and placement. They carry ph-no-capture,
    // so autocapture skips them, while other links on the page (the More apps cards) are still autocaptured.
    for (const width of [390, 1440]) {
      const app = await context.newPage();
      await app.setViewportSize({ width, height: 900 });
      await app.goto(`${site}/cloud-media-shrinker/`, { waitUntil: 'networkidle' });
      await app.waitForFunction(() => window.posthog?.__loaded === true);
      await app.evaluate(() => {
        for (const type of ['click', 'auxclick']) window.addEventListener(type, event => { if (event.target.closest?.('a[href]')) event.preventDefault(); });
      });
      const start = captured.length;
      await app.locator('.c-hero-copy [data-store="app_store"]').click();
      await app.locator('.c-hero-copy [data-store="polar"]').click({ button: 'middle' });
      await app.locator('.c-jump a', { hasText: 'Features' }).click();
      await app.locator('.c-cta [data-store="polar"]').click();
      await app.locator('.c-app').first().click();
      const autoMoreApps = () => captured.slice(start).filter(e => e.event === '$autocapture' && /ct=cms_more_apps/.test(e.properties.$elements_chain || ''));
      for (let i = 0; i < 40 && !autoMoreApps().length; i += 1) await app.waitForTimeout(200);
      await app.waitForTimeout(500);
      const polar = await app.locator('.c-hero-copy [data-store="polar"]').getAttribute('href');
      const store = await app.locator('.c-hero-copy [data-store="app_store"]').getAttribute('href');
      const sent = captured.slice(start).filter(e => e.event === 'app_download_click').map(e => e.properties);
      assert.deepEqual(sent.map(({ app: name, store: where, placement, link_text, destination }) => ({ name, where, placement, link_text, destination })), [
        { name: 'cloud-media-shrinker', where: 'app_store', placement: 'hero', link_text: 'Download on the App Store', destination: store },
        { name: 'cloud-media-shrinker', where: 'polar', placement: 'hero', link_text: 'Direct download for Mac · $9.49', destination: polar },
        { name: 'cloud-media-shrinker', where: 'polar', placement: 'end', link_text: 'Direct download for Mac · $9.49', destination: polar },
      ], `download clicks at ${width}px; other links send none`);
      assert.ok(sent.every(props => props.$cookieless_mode === true && props.$current_url === `${site}/cloud-media-shrinker/`), `cookieless download clicks at ${width}px`);
      assert.ok(autoMoreApps().length > 0, `More apps clicks are still autocaptured at ${width}px`);
      assert.ok(!captured.slice(start).some(e => e.event === '$autocapture' && /data-store|polar\.sh|id6824383256/.test(e.properties.$elements_chain || '')), `download buttons are not autocaptured too at ${width}px`);
      await app.close();
    }

    // Blog articles send suggested_blog_click for recommended post cards and tldr_link_click for TL;DR links.
    for (const width of [390, 820, 1440]) {
      const blog = await context.newPage();
      await blog.setViewportSize({ width, height: 900 });
      await blog.goto(`${site}/blog/secretary-chat-architecture.html`, { waitUntil: 'networkidle' });
      await blog.waitForFunction(() => window.posthog?.__loaded === true);
      await blog.evaluate(() => {
        for (const type of ['click', 'auxclick']) window.addEventListener(type, event => { if (event.target.closest?.('a[href]')) event.preventDefault(); });
      });
      const start = captured.length;

      // TL;DR anchor link clicked with left click, another with middle click
      await blog.locator('.article-tldr a[href="#two-loops"]').click();
      await blog.locator('.article-tldr a[href="#prompts"]').click({ button: 'middle' });

      // Recommended post cards clicked in the article-related grid: left click on card 1, middle click on card 2
      const cards = blog.locator('.article-related .related-card');
      await cards.nth(0).locator('h3 a').click();
      await cards.nth(1).locator('h3 a').click({ button: 'middle' });

      // Clicks outside related cards and TL;DR (e.g. "More to explore" and footer link) send none
      await blog.locator('.article-related-projects a').first().click();
      await blog.locator('.article-back a').click();

      await blog.waitForTimeout(1500);

      const tldrEvents = captured.slice(start).filter(e => e.event === 'tldr_link_click').map(e => e.properties);
      const suggestedEvents = captured.slice(start).filter(e => e.event === 'suggested_blog_click').map(e => e.properties);

      assert.deepEqual(tldrEvents.map(({ source, destination, label, is_anchor }) => ({ source, destination, label, is_anchor })), [
        { source: '/blog/secretary-chat-architecture.html', destination: `${site}/blog/secretary-chat-architecture.html`, label: 'Two-loop split →', is_anchor: true },
        { source: '/blog/secretary-chat-architecture.html', destination: `${site}/blog/secretary-chat-architecture.html`, label: 'Copyable prompts →', is_anchor: true },
      ], `tldr clicks at ${width}px; outside links send none`);

      assert.deepEqual(suggestedEvents.map(({ source, destination, title, position }) => ({ source, destination, title, position })), [
        { source: '/blog/secretary-chat-architecture.html', destination: `${site}/blog/multi-agent-orchestration.html`, title: 'Coordinating Claude, GPT and Gemini on one codebase', position: 1 },
        { source: '/blog/secretary-chat-architecture.html', destination: `${site}/blog/agent-qa-separate-macos-account.html`, title: 'Giving my AI agent its own Mac account for QA', position: 2 },
      ], `suggested blog clicks at ${width}px; outside links send none`);

      assert.ok(tldrEvents.every(props => props.$cookieless_mode === true && props.$current_url === `${site}/blog/secretary-chat-architecture.html`), `cookieless tldr clicks at ${width}px`);
      assert.ok(suggestedEvents.every(props => props.$cookieless_mode === true && props.$current_url === `${site}/blog/secretary-chat-architecture.html`), `cookieless suggested blog clicks at ${width}px`);

      await blog.close();
    }

    // Test a non-anchor TL;DR link on claude-code-max-effort.html to verify is_anchor: false
    const effortBlog = await context.newPage();
    await effortBlog.goto(`${site}/blog/claude-code-max-effort.html`, { waitUntil: 'networkidle' });
    await effortBlog.waitForFunction(() => window.posthog?.__loaded === true);
    await effortBlog.evaluate(() => {
      for (const type of ['click', 'auxclick']) window.addEventListener(type, event => { if (event.target.closest?.('a[href]')) event.preventDefault(); });
    });
    const effortStart = captured.length;
    await effortBlog.locator('.article-tldr a[href="multi-agent-orchestration.html"]').click();
    await effortBlog.waitForTimeout(1500);
    const effortTldr = captured.slice(effortStart).filter(e => e.event === 'tldr_link_click').map(e => e.properties);
    assert.deepEqual(effortTldr.map(({ source, destination, label, is_anchor }) => ({ source, destination, label, is_anchor })), [
      { source: '/blog/claude-code-max-effort.html', destination: `${site}/blog/multi-agent-orchestration.html`, label: 'Multi-agent follow-up →', is_anchor: false },
    ], 'non-anchor tldr link click sends is_anchor: false');
    await effortBlog.close();

    // Email sign-ups send email_signup with the ticked topics, and a failed one sends email_signup_failed.
    // The address itself never reaches PostHog. The sign-up function is faked here.
    for (const width of [390, 820, 1440]) {
      const form = await context.newPage();
      await form.setViewportSize({ width, height: 900 });
      let reply = { ok: true };
      await form.route('https://danielyakobian.com/api/subscribe/', route => route.fulfill({ status: reply.ok ? 200 : 502, contentType: 'application/json', headers: { 'access-control-allow-origin': site }, body: JSON.stringify(reply) }));
      await form.goto(`${site}/`, { waitUntil: 'networkidle' });
      await form.waitForFunction(() => window.posthog?.__loaded === true);
      const start = captured.length;
      await form.getByLabel(/Beta tester invites/).check();
      await form.getByLabel(/Promos/).check();
      await form.locator('.signup-email').fill('private-reader@example.com');
      await form.locator('.signup-button').click();
      await form.waitForSelector('.signup.is-done');
      await form.locator('.signup-edit').click();
      reply = { ok: false, error: 'provider_error' };
      await form.locator('.signup-email').fill('private-reader@example.com');
      await form.locator('.signup-button').click();
      await form.waitForFunction(() => document.querySelector('.signup-status').dataset.kind === 'error');
      await form.waitForTimeout(1500);
      const sent = captured.slice(start);
      const signups = sent.filter(e => /^email_signup/.test(e.event)).map(({ event, properties: p }) => ({ event, topics: p.topics, topic_count: p.topic_count, new_apps: p.new_apps, beta: p.beta, promos: p.promos, error: p.error }));
      assert.deepEqual(signups, [
        { event: 'email_signup', topics: ['beta', 'promos'], topic_count: 2, new_apps: false, beta: true, promos: true, error: undefined },
        { event: 'email_signup_failed', topics: ['beta', 'promos'], topic_count: 2, new_apps: false, beta: true, promos: true, error: 'provider_error' },
      ], `sign-up events at ${width}px`);
      assert.ok(!JSON.stringify(sent).includes('private-reader'), `the email address is never sent to PostHog at ${width}px`);
      await form.close();
    }

    // The guest gate page never loads analytics.
    const before = captured.length;
    const gateRequests = [];
    const gate = await context.newPage();
    gate.on('request', r => gateRequests.push(r.url()));
    await gate.goto(`${site}/gate/`, { waitUntil: 'networkidle' });
    assert.ok(!gateRequests.some(url => /analytics\.js|posthog|dy-relay/.test(url)), 'gate page loads no analytics');
    assert.equal(captured.length, before, 'gate page sends nothing');
    console.log(`Analytics checks passed: ${tracked.length} tracked pages, ${untracked.length} untracked, cookieless page view without query or fragment, web vitals, project clicks, rental clicks, resume downloads, suggested blog clicks, TL;DR link clicks and sign-up events at 3 widths.`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
