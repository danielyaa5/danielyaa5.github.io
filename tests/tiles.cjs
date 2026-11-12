// Whole-tile links on the home page: every project tile and Writings card opens its title link from
// anywhere on the tile, while the tile's other links stay on top with their own addresses.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const TILES = '.featured-pick, #project-list .project, .writing-card';
const HOVER_BORDER = { light: 'rgb(120, 145, 130)', dark: 'rgb(95, 138, 108)' };

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  await fs.mkdir('test-results', { recursive: true });
  const runs = [];
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const width of [390, 820, 1440]) {
        const label = `${colorScheme} ${width}px`;
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, reducedMotion: 'reduce' });
        const page = await context.newPage();
        // Nothing leaves the machine: outside addresses (stores, GitHub, project sites) get an empty page.
        await page.route(url => !url.href.startsWith(base), route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }));
        await page.goto(`${base}/`, { waitUntil: 'networkidle' });
        const count = await page.locator(TILES).count();
        assert.equal(count, 16, `3 featured, 10 other and 3 writing tiles at ${label}`);

        // Hit-test each tile: its corners, art, description and chips open the title link;
        // each other link in the tile is on top at its own center.
        for (let i = 0; i < count; i++) {
          const tile = page.locator(TILES).nth(i);
          await tile.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
          const result = await tile.evaluate(node => {
            const main = node.querySelector('.project-name, h3 a');
            const hit = (x, y) => {
              const element = document.elementFromPoint(x, y);
              if (!element || element.closest('nav')) return 'covered';
              return element.closest('a') || null;
            };
            const center = element => {
              const box = element.getBoundingClientRect();
              return [box.left + box.width / 2, box.top + box.height / 2];
            };
            const box = node.getBoundingClientRect();
            const points = {
              'top-left corner': [box.left + 4, box.top + 4],
              'top-right corner': [box.right - 4, box.top + 4],
            };
            for (const selector of ['.project-illustration', ':scope > img', '.writing-thumb', '.project-benefit', '.featured-copy > p', ':scope > p', '.category', '.project-status']) {
              const element = node.querySelector(selector);
              if (element) points[selector] = center(element);
            }
            const misses = Object.entries(points).filter(([, [x, y]]) => {
              const link = hit(x, y);
              return link !== 'covered' && link !== main;
            }).map(([name]) => name);
            const others = [...node.querySelectorAll('a[href]')].filter(link => link !== main).map(link => {
              const found = hit(...center(link));
              return { text: link.textContent.trim(), onTop: found === 'covered' || found === link };
            });
            return { name: main.textContent.trim(), href: main.href, misses, others };
          });
          assert.deepEqual(result.misses, [], `${result.name}: every part of the tile opens the title link at ${label}`);
          for (const other of result.others) assert.ok(other.onTop, `${result.name}: "${other.text}" stays clickable at ${label}`);
          if (i < 13) assert.ok(result.others.length >= 1, `${result.name} keeps its own button link`);
        }

        // Hover: the tile body underlines the title and darkens the border; the tile's other links don't.
        for (const selector of ['.featured-pick', '#project-list .project', '.writing-card']) {
          const tile = page.locator(selector).first();
          await tile.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
          await page.mouse.move(1, 1);
          const rest = await tile.evaluate(node => getComputedStyle(node).borderTopColor);
          assert.notEqual(rest, HOVER_BORDER[colorScheme], `${selector} rests with its own border at ${label}`);
          const body = tile.locator('.project-benefit, .featured-copy > p, :scope > p').first();
          const bodyBox = await body.boundingBox();
          await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2);
          await page.waitForFunction(([node, color]) => getComputedStyle(node).borderTopColor === color, [await tile.elementHandle(), HOVER_BORDER[colorScheme]], { timeout: 2000 });
          assert.match(await tile.locator('.project-name, h3 a').first().evaluate(link => getComputedStyle(link).textDecorationLine), /underline/, `${selector} title underlines on tile hover at ${label}`);
          await tile.screenshot({ path: `test-results/tiles-hover-${selector.replace(/\W+/g, '')}-${colorScheme}-${width}.png` });
          const button = tile.locator('.featured-link, .project-link, .writing-link').first();
          const buttonBox = await button.boundingBox();
          await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
          await page.waitForTimeout(250);
          assert.doesNotMatch(await tile.locator('.project-name, h3 a').first().evaluate(link => getComputedStyle(link).textDecorationLine), /underline/, `${selector} title stays plain while its button is hovered at ${label}`);
          assert.notEqual(await tile.evaluate(node => getComputedStyle(node).borderTopColor), HOVER_BORDER[colorScheme], `${selector} border stays put while its button is hovered at ${label}`);
        }
        await page.mouse.move(1, 1);

        // Keyboard: Tab reaches every tile link in order; a title link rings the whole tile, other links ring themselves.
        await page.locator('.hero-actions a').last().focus();
        const seen = [];
        for (let step = 0; step < 80; step++) {
          await page.keyboard.press('Tab');
          const focus = await page.evaluate(selector => {
            const link = document.activeElement;
            const tile = link.closest(selector);
            if (!tile) return { inTile: false, end: link.matches('.all-writing') };
            const main = tile.querySelector('.project-name, h3 a');
            return {
              inTile: true,
              main: link === main,
              visible: link.matches(':focus-visible'),
              own: getComputedStyle(link).outlineStyle,
              ring: getComputedStyle(link, '::after').outlineStyle,
              text: link.textContent.trim(),
            };
          }, TILES);
          if (focus.end) break;
          if (!focus.inTile) continue;
          seen.push(focus);
          assert.ok(focus.visible, `"${focus.text}" shows keyboard focus at ${label}`);
          if (focus.main) {
            assert.equal(focus.own, 'none', `"${focus.text}" moves its ring to the tile at ${label}`);
            assert.equal(focus.ring, 'solid', `"${focus.text}" rings its tile at ${label}`);
            if (seen.filter(item => item.main).length === 4) {
              await page.evaluate(() => document.activeElement.closest('.project').scrollIntoView({ block: 'center', behavior: 'instant' }));
              await page.locator('#project-list .project').first().screenshot({ path: `test-results/tiles-focus-${colorScheme}-${width}.png` });
            }
          } else {
            assert.equal(focus.own, 'solid', `"${focus.text}" rings itself at ${label}`);
          }
        }
        assert.equal(seen.filter(item => item.main).length, 16, `every tile title is reachable by Tab at ${label}`);

        // Real clicks: a tile's description opens the title's address; its button keeps its own.
        const open = async (locator, expected) => {
          await locator.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
          const box = await locator.boundingBox();
          await Promise.all([page.waitForURL(expected, { timeout: 5000 }), page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)]);
          await page.goto(`${base}/`, { waitUntil: 'networkidle' });
        };
        const buyOrRent = () => page.locator('#project-list .project', { hasText: 'Buy or Rent' });
        await open(buyOrRent().locator('.project-benefit'), 'https://thebuyorrentcalculator.com/');
        await open(buyOrRent().locator('.project-illustration'), 'https://thebuyorrentcalculator.com/');
        await open(buyOrRent().locator('.project-link'), 'https://github.com/danielyaa5/buy-or-rent-web');
        await open(page.locator('.featured-lead .featured-copy > p'), 'https://danielyaa5.github.io/cloud-media-shrinker/');
        await open(page.locator('.featured-lead .featured-link'), 'https://apps.apple.com/app/cloud-media-shrinker/id6824383256');
        await open(page.locator('.star-count'), 'https://github.com/danielyaa5/puml-for-markdown/stargazers');
        await open(page.locator('.writing-card').first().locator(':scope > p'), `${base}/blog/predictive-agent-qa.html`);
        runs.push(label);
        await context.close();
      }
    }
    console.log(`Tile checks passed at ${runs.join(', ')}; screenshots in test-results/tiles-*.png`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
