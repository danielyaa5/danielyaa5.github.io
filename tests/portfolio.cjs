const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:4173';
const expected = ['Cloud Media Shrinker','Beckon','AI-billboard','Gate Opener Widget','TagTracker','Print Progress','H2D Custom Dashboard','puml-for-markdown','Buy or Rent','qtfaststart2'];
(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
  const report = {url:base, checks:[]};
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    await page.goto(base, {waitUntil:'networkidle'});
    assert.deepEqual(await page.locator('.project h3').allTextContents(), expected);
    assert.doesNotMatch(await page.locator('body').innerText(), /MimiBot|Photo Review/i);
    assert.equal(await page.locator('.identity').innerText(), 'Daniel.');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'light');
    assert.ok(await page.locator('.project-icon').evaluateAll(images=>images.length===10 && images.every(img=>img.complete && img.naturalWidth>0)));
    assert.equal(await page.locator('.project-link').count(),9);
    assert.equal(await page.locator('.project a[href*="ai-billboard"]').count(),0);
    await page.getByRole('link',{name:'Explore selected work'}).click();
    await page.waitForURL('**/#work');
    assert.ok(await page.locator('#work').evaluate(el=>el.getBoundingClientRect().top<80));
    await page.getByRole('link',{name:'About',exact:true}).click();
    await page.waitForURL('**/#about');
    await page.getByRole('link',{name:'Back to top'}).click();
    await page.waitForURL('**/#top');
    await fs.mkdir('test-results',{recursive:true});
    for (const width of [1440,768,390,320]) {
      await page.setViewportSize({width,height:1000});
      const layout = await page.evaluate(()=>({
        fits:document.documentElement.scrollWidth<=innerWidth,
        cards:[...document.querySelectorAll('.project')].map(card=>({
          benefit:parseFloat(getComputedStyle(card.querySelector('.project-benefit')).fontSize),
          name:parseFloat(getComputedStyle(card.querySelector('h3')).fontSize),
          detail:parseFloat(getComputedStyle(card.querySelector('.project-detail')).fontSize),
          inside:[...card.children].every(el=>el.getBoundingClientRect().right<=card.getBoundingClientRect().right+1)
        }))
      }));
      assert.ok(layout.fits,`Page overflows at ${width}px`);
      assert.ok(layout.cards.every(c=>c.benefit>c.name && c.name>c.detail && c.inside),`Card typography/fit at ${width}px`);
      if(width===1440 || width===390) await page.screenshot({path:`test-results/portfolio-${width}.png`,fullPage:true});
      report.checks.push({width,passed:true});
    }
    assert.deepEqual(errors,[]);
    report.passed=true;
    await fs.writeFile('test-results/report.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
