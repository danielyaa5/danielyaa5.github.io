const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const root = path.join(__dirname, '..');
const widths = [1920, 1650, 1440, 1280, 1024, 900, 768, 600, 414, 375, 320];

// The web resume must keep a large PDF download in the first screen at every width,
// stay inside the frame, and say the same thing as the PDF it offers. Layout checks run with
// reduced motion so every section is shown; the scroll effects are checked separately below.
const norm = text => text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

(async () => {
  const pdf = path.join(root, 'assets/Daniel_Yakobian_Resume.pdf');
  assert.ok(fs.existsSync(pdf), 'resume PDF exists');
  const html = fs.readFileSync(path.join(root, 'resume/index.html'), 'utf8');
  const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(home, /<a href="resume\/" data-icon="resume">Resume<\/a>/, 'home navigation opens the web resume');

  let pdfText = null;
  try { pdfText = norm(execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' })); } catch { console.warn('pdftotext not installed; skipping the PDF wording check'); }

  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const failures = [];
  try {
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await page.goto(`${base}/resume/`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const r = await page.evaluate(() => {
        const box = el => el.getBoundingClientRect();
        const frame = box(document.querySelector('.page-frame'));
        const dl = document.querySelector('.download');
        const d = box(dl);
        const nav = document.querySelector('.site-header nav');
        const n = box(nav);
        const navFixed = getComputedStyle(nav).position === 'fixed';
        const problems = [];
        for (const el of document.querySelectorAll('.r-hero, .r-hero > *, .impact > div, .ledger, .exp-side, .role, .skills div, .end-cta, .end-cta .button')) {
          const b = box(el);
          if (b.left < frame.left - 1 || b.right > frame.right + 1) problems.push(`${el.className || el.tagName} leaves the frame`);
        }
        const bullets = [...document.querySelectorAll('.role li')].map(li => li.textContent);
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          download: { top: d.top, bottom: d.bottom, height: d.height, width: d.width, href: dl.getAttribute('href'), download: dl.hasAttribute('download') },
          coveredByDock: navFixed && d.bottom > n.top && d.top < n.bottom && d.right > n.left && d.left < n.right,
          roles: document.querySelectorAll('#experience .role').length,
          pdfLinks: [...document.querySelectorAll('a[href$=".pdf"]')].map(a => ({ href: a.href, download: a.hasAttribute('download') })),
          bullets,
          hidden: [...document.querySelectorAll('.reveal')].filter(el => getComputedStyle(el).opacity !== '1').length,
          problems,
        };
      });
      const where = `${width}px`;
      if (r.overflow) failures.push(`${where}: page scrolls sideways`);
      if (r.problems.length) failures.push(`${where}: ${r.problems.join(', ')}`);
      if (r.download.bottom > 900) failures.push(`${where}: download button is below the first screen (bottom ${Math.round(r.download.bottom)})`);
      if (r.download.height < 64) failures.push(`${where}: download button is only ${r.download.height}px tall`);
      if (r.coveredByDock) failures.push(`${where}: the navigation dock covers the download button`);
      if (r.roles !== 5) failures.push(`${where}: expected 5 roles, found ${r.roles}`);
      if (r.hidden) failures.push(`${where}: ${r.hidden} blocks stay hidden with reduced motion`);
      for (const link of r.pdfLinks) {
        if (!link.download) failures.push(`${where}: ${link.href} lacks the download attribute`);
        const res = await page.request.get(link.href);
        if (res.status() !== 200 || !String(res.headers()['content-type']).includes('pdf')) failures.push(`${where}: ${link.href} returned ${res.status()} ${res.headers()['content-type']}`);
      }
      if (width === 1440 && pdfText) {
        for (const bullet of r.bullets) if (!pdfText.includes(norm(bullet).replace(/ \(/g, ' ('))) {
          // pdftotext wraps long lines; compare without spaces as a fallback.
          if (!pdfText.replace(/ /g, '').includes(norm(bullet).replace(/ /g, ''))) failures.push(`bullet not in the PDF: ${bullet.slice(0, 60)}…`);
        }
      }
      fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
      await page.screenshot({ path: path.join(root, `test-results/resume-${width}.png`), fullPage: true });
      await page.close();
    }

    // Scroll effects: the bar appears after the big button, names the section and role in view,
    // the side panel follows the role on wide screens, and the numbers end on their real values.
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/resume/`, { waitUntil: 'networkidle' });
      const where = `${width}px scroll`;
      const state = () => page.evaluate(() => ({
        bar: document.querySelector('.scroll-bar').classList.contains('is-shown'),
        inert: document.querySelector('.scroll-bar').inert,
        label: document.querySelector('.scroll-where').textContent,
        panel: document.querySelector('.now-org').textContent,
        panelShown: getComputedStyle(document.querySelector('.now')).display !== 'none',
        active: [...document.querySelectorAll('#experience .role.is-active')].map(r => r.id),
        numbers: [...document.querySelectorAll('[data-count]')].map(el => el.textContent),
      }));
      let st = await state();
      if (st.bar || !st.inert) failures.push(`${where}: scroll bar shows before the big button leaves the screen`);
      await page.evaluate(() => { const el = document.querySelector('#tinder'); scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight * 0.2); });
      await page.waitForTimeout(1500);
      st = await state();
      if (!st.bar || st.inert) failures.push(`${where}: scroll bar hidden after scrolling to Tinder`);
      if (!/Experience/.test(st.label) || !/Tinder/.test(st.label)) failures.push(`${where}: bar says "${st.label}" at Tinder`);
      if (st.active.join() !== 'tinder') failures.push(`${where}: active role is ${st.active.join() || 'none'}`);
      if (width > 850 && (!st.panelShown || st.panel !== 'Tinder')) failures.push(`${where}: side panel shows "${st.panel}"`);
      if (st.numbers.join(' ') !== '$47M 85% 15→2 60%') failures.push(`${where}: numbers ended as ${st.numbers.join(' ')}`);
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(600);
      st = await state();
      if (!/Education/.test(st.label)) failures.push(`${where}: bar says "${st.label}" at the bottom`);
      if (errors.length) failures.push(`${where}: script errors ${errors.join('; ')}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  assert.deepEqual(failures, [], failures.join('\n'));
  console.log(`Resume checks passed at ${widths.length} widths; screenshots in test-results/resume-*.png`);
})().catch(error => { console.error(error.message || error); process.exitCode = 1; });
