const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:4173';
const expected = ['puml-for-markdown','Cloud Media Shrinker','Beckon','Print Progress','AI-billboard','TagTracker','H2D Custom Dashboard','Buy or Rent','qtfaststart2'];
(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
  const report = {url:base, checks:[]};
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    const failedAssets=[]; page.on('response', response=>{
      if(response.url().startsWith(base) && response.status()>=400) failedAssets.push(response.url());
    });
    await page.goto(base, {waitUntil:'networkidle'});
    assert.deepEqual(await page.locator('.project h2').allTextContents(), expected);
    assert.doesNotMatch(await page.content(), /MimiBot|Photo Review/i);
    assert.equal(await page.locator('.identity').innerText(), 'Daniel');
    assert.equal((await page.locator('h1').innerText()).replace(/\s+/g,' '), 'Small frustrations. Useful software.');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'light');
    assert.ok(await page.locator('.project-illustration').evaluateAll(images=>images.length===9 && images.every(img=>img.complete && img.naturalWidth>0)));
    assert.ok(await page.locator('.hero-illustration').evaluate(img=>img.complete && img.naturalWidth>0));
    assert.equal(await page.locator('.project-link').count(),8);
    assert.equal(await page.locator('.project a[href*="ai-billboard"]').count(),0);
    await page.locator('.hero-actions').getByRole('link',{name:'Writing',exact:true}).click();
    await page.waitForURL('**/#writing');
    // The section sits near the page's end, so it scrolls into view rather than to the top.
    await page.waitForFunction(()=>{const r=document.querySelector('#writing').getBoundingClientRect(); return r.top>=0 && r.top<innerHeight;});
    const aboutButton = page.getByRole('button',{name:'About',exact:true});
    await aboutButton.click();
    const aboutDialog = page.getByRole('dialog',{name:'Hi, I’m Daniel.'});
    await aboutDialog.waitFor({state:'visible'});
    assert.match(await aboutDialog.innerText(),/I build software/);
    await page.keyboard.press('Escape');
    await aboutDialog.waitFor({state:'hidden'});
    assert.ok(await aboutButton.evaluate(el=>el===document.activeElement));
    await aboutButton.click();
    await page.getByRole('button',{name:'Close About'}).click();
    await aboutDialog.waitFor({state:'hidden'});
    await page.getByRole('link',{name:'Back to top'}).click();
    await page.waitForURL('**/#top');
    await fs.mkdir('test-results',{recursive:true});
    for (const width of [1440,1123,768,621,620,390,320]) {
      await page.setViewportSize({width,height:1000});
      const layout = await page.evaluate(()=>({
        fits:document.documentElement.scrollWidth<=innerWidth,
        cards:[...document.querySelectorAll('.project')].map(card=>({
          benefit:parseFloat(getComputedStyle(card.querySelector('.project-benefit')).fontSize),
          name:parseFloat(getComputedStyle(card.querySelector('h2')).fontSize),
          detail:parseFloat(getComputedStyle(card.querySelector('.category')).fontSize),
          inside:[...card.querySelectorAll('*')].every(el=>el.getBoundingClientRect().right<=card.getBoundingClientRect().right+1),
          artBesideCopy:card.querySelector('.project-art').getBoundingClientRect().right<=card.querySelector('.project-copy').getBoundingClientRect().left,
          linkSize:card.querySelector('.project-link') ? parseFloat(getComputedStyle(card.querySelector('.project-link')).fontSize) : 12,
          linkHeight:card.querySelector('.project-link')?.getBoundingClientRect().height ?? 44
        }))
      }));
      assert.ok(layout.fits,`Page overflows at ${width}px`);
      assert.ok(layout.cards.every(c=>c.benefit>c.name && c.name>c.detail && c.inside && c.artBesideCopy),`Card typography/fit at ${width}px`);
      assert.ok(layout.cards.every(c=>c.detail>=12 && c.linkSize>=12 && c.linkHeight>=44),`Readable labels and usable project links at ${width}px`);
      await aboutButton.click();
      await aboutDialog.waitFor({state:'visible'});
      assert.ok(await aboutDialog.evaluate(el=>{
        const rect=el.getBoundingClientRect();
        return rect.left>=0 && rect.right<=innerWidth && rect.top>=0 && rect.bottom<=innerHeight;
      }),`About dialog fits at ${width}px`);
      await page.keyboard.press('Escape');
      if(width===1440 || width===1123 || width===390) {
        const pageHeight = await page.evaluate(()=>document.documentElement.scrollHeight);
        await page.setViewportSize({width,height:pageHeight});
        await page.screenshot({path:`test-results/portfolio-${width}.png`,fullPage:false});
      }
      report.checks.push({width,passed:true});
    }
    assert.deepEqual(errors,[]);
    assert.deepEqual(failedAssets,[]);
    const iconURL=await page.locator('link[rel="icon"]').getAttribute('href');
    assert.equal((await page.request.get(new URL(iconURL,base).href)).status(),200);
    report.passed=true;
    await fs.writeFile('test-results/report.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
