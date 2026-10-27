const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

// Run: node tests/mobile.cjs https://danielyakobian.com
// Touch emulation in Chromium; this does not substitute for testing iOS Safari.
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const output = process.env.MOBILE_QA_OUTPUT || 'test-results/mobile';
const sizes = JSON.parse(process.env.MOBILE_QA_SIZES || '[[320,568],[360,800],[375,667],[390,844],[393,852],[412,915],[430,932],[667,375],[844,390],[768,1024]]');
const report = { url: base, engine: 'Chromium with touch/mobile emulation', checks: [], errors: [], failedAssets: [] };

async function capture(page, name) {
  await page.screenshot({path:path.join(output, `${name}.png`),fullPage:true});
}

async function layout(page) {
  return page.evaluate(() => {
    const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const rect = e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
    const controls = [...document.querySelectorAll('a,button')].filter(visible).filter(e=>!e.closest('dialog'));
    const small = controls.map(e=>({label:(e.getAttribute('aria-label')||e.textContent).trim().replace(/\s+/g,' ').slice(0,75),...rect(e)})).filter(r=>r.width<24||r.height<24);
    const nav=[...document.querySelectorAll('nav a,nav button')].map(e=>({label:e.textContent.trim(),...rect(e),font:parseFloat(getComputedStyle(e).fontSize)}));
    const collisions=[];
    const items=[document.querySelector('.identity'),...document.querySelectorAll('nav a,nav button')].filter(Boolean);
    for(let i=0;i<items.length;i++) for(let j=i+1;j<items.length;j++) {
      const a=rect(items[i]),b=rect(items[j]);
      if(Math.min(a.right,b.right)-Math.max(a.x,b.x)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1) collisions.push([items[i].textContent.trim(),items[j].textContent.trim()]);
    }
    return {width:innerWidth,height:innerHeight,sideways:document.documentElement.scrollWidth>innerWidth,nav,collisions,smallTargets:small,images:[...document.images].filter(visible).filter(i=>!i.complete||!i.naturalWidth).map(i=>i.getAttribute('src'))};
  });
}

(async()=>{
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  try {
    for(const [width,height] of sizes) {
      const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:2,reducedMotion:'reduce'});
      const page=await context.newPage();
      page.on('pageerror',e=>report.errors.push({width,error:e.message}));
      page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)report.failedAssets.push({width,url:r.url(),status:r.status()});});
      const result={width,height,failures:[]};
      async function check(name,fn) {try{await fn();result[name]='passed';}catch(e){result[name]='failed';result.failures.push({name,error:e.message});}}
      await page.goto(base,{waitUntil:'networkidle'});
      await page.evaluate(()=>Promise.all([...document.images].map(i=>{i.loading='eager';return i.decode();})));
      result.layout=await layout(page);
      await capture(page,`home-${width}x${height}`);
      await page.screenshot({path:path.join(output,`top-${width}x${height}.png`)});
      await page.locator('.featured-projects').screenshot({path:path.join(output,`featured-${width}x${height}.png`)});
      await page.locator('.site-footer').screenshot({path:path.join(output,`footer-${width}x${height}.png`)});
      await check('homeFits',async()=>{assert.equal(result.layout.sideways,false);assert.deepEqual(result.layout.collisions,[]);assert.deepEqual(result.layout.images,[]);});
      await check('readableNavigation',async()=>{
        assert.ok(result.layout.nav.every(n=>n.font>=14),'Phone navigation stays readable');
        const lines=await page.locator('nav a,nav button').evaluateAll(links=>links.map(e=>{
          const range=document.createRange();range.selectNodeContents(e);
          return {label:e.textContent.trim(),textHeight:range.getBoundingClientRect().height,font:parseFloat(getComputedStyle(e).fontSize)};
        }));
        assert.ok(lines.every(n=>n.textHeight<=n.font*1.5),'Navigation labels stay on one line');
      });
      await check('secondaryTouchTargets',async()=>{
        result.touchTargets=[];
        for(const target of await page.locator('.identity,nav a,nav button,.star-count,.site-footer a').all()) {
          await target.scrollIntoViewIfNeeded();
          const metrics=await target.evaluate(e=>{
            const r=e.getBoundingClientRect();
            const points=[[r.left+r.width/2,r.top+2],[r.left+r.width/2,r.bottom-2],[r.left+2,r.top+r.height/2],[r.right-2,r.top+r.height/2]];
            return {label:(e.getAttribute('aria-label')||e.textContent).trim(),width:r.width,height:r.height,edgesClickable:points.every(([x,y])=>document.elementFromPoint(x,y)?.closest('a,button')===e)};
          });
          result.touchTargets.push(metrics);
          assert.ok(metrics.width>=44&&metrics.height>=44,`${metrics.label} must have a 44px touch target`);
          assert.ok(metrics.edgesClickable,`${metrics.label} touch padding must receive input without overlap`);
        }
        await page.evaluate(()=>scrollTo(0,0));
      });
      await check('workNavigation',async()=>{await page.locator('nav a[href="#work"]').tap();assert.equal(new URL(page.url()).hash,'#work');});
      await check('touchFilters',async()=>{
        for(const [filter,count] of [['printing',3],['mac',2],['web',2],['developer',1],['all',8]]) {
          await page.locator(`[data-filter="${filter}"]`).tap();
          assert.equal(await page.locator('.project:visible').count(),count);
          assert.equal(await page.locator('[data-filter][aria-pressed="true"]').count(),1);
          assert.match(await page.locator('.filter-count').innerText(),new RegExp(`^${count} project${count===1?'':'s'}`));
          if(filter==='printing') await page.locator('#project-list').screenshot({path:path.join(output,`printing-${width}x${height}.png`)});
        }
      });
      await check('shopTileHitArea',async()=>{
        await page.locator('[data-filter="printing"]').tap();
        await page.locator('.project-shop').scrollIntoViewIfNeeded();
        const destination=await page.locator('.project-shop').evaluate(e=>{const r=e.getBoundingClientRect();const target=document.elementFromPoint(r.left+r.width/2,r.top+20);return target.closest('a')?.href;});
        assert.equal(destination,'https://www.etsy.com/shop/UrbanTechGoods');
        await page.locator('[data-filter="all"]').tap();
      });
      await check('aboutTouchClose',async()=>{
        await page.getByRole('button',{name:'About',exact:true}).tap();
        const dialog=page.locator('#about');
        await dialog.waitFor({state:'visible'});
        result.dialog=await dialog.evaluate(e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,overflow:getComputedStyle(e).overflowY};});
        await page.screenshot({path:path.join(output,`about-${width}x${height}.png`)});
        assert.ok(result.dialog.left>=0&&result.dialog.right<=width&&result.dialog.top>=0&&result.dialog.bottom<=height,'About must fit the viewport');
        assert.ok(result.dialog.scrollWidth<=result.dialog.clientWidth,'About content must not scroll horizontally');
        const lastLink=dialog.getByRole('link',{name:'More on GitHub',exact:true});
        await lastLink.scrollIntoViewIfNeeded();
        assert.ok(await lastLink.evaluate(e=>{const r=e.getBoundingClientRect(),d=e.closest('dialog').getBoundingClientRect();return r.top>=d.top&&r.bottom<=d.bottom;}),'Bottom About link must be reachable by scrolling');
        await page.getByRole('button',{name:'Close About'}).tap();
        await dialog.waitFor({state:'hidden'});
      });
      // Keep the rest of the checks usable even if the modal test failed.
      if(await page.locator('#about').isVisible()) await page.getByRole('button',{name:'Close About'}).tap();
      await check('writingNavigation',async()=>{await page.locator('.hero-actions a[href="#writing"]').tap();assert.equal(new URL(page.url()).hash,'#writing');});
      await check('backToTop',async()=>{await page.getByRole('link',{name:'Back to top',exact:true}).tap();assert.equal(new URL(page.url()).hash,'#top');assert.ok(await page.evaluate(()=>scrollY<30));});
      await check('blogAndArticle',async()=>{
        await page.getByRole('navigation').getByRole('link',{name:'Blog',exact:true}).tap();
        await page.waitForURL('**/blog/');
        await page.evaluate(()=>Promise.all([...document.images].map(i=>{i.loading='eager';return i.decode();})));
        assert.equal(await page.locator('.post-card .writing-thumb').count(),6);
        result.blogLayout=await layout(page);
        assert.equal(result.blogLayout.sideways,false);
        assert.deepEqual(result.blogLayout.images,[]);
        assert.ok(result.blogLayout.nav.every(n=>n.font>=14&&n.width>=44&&n.height>=44),'Blog navigation keeps readable touch targets');
        const article=page.getByRole('link',{name:'Teaching my K1 Max to turn on its own chamber heater',exact:true});
        await article.tap();
        await page.waitForURL('**/k1-max-chamber-heater.html');
        await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
        result.articleLayout=await layout(page);
        await capture(page,`article-${width}x${height}`);
        assert.equal(result.articleLayout.sideways,false);
        await page.getByRole('link',{name:'← All posts',exact:true}).tap();
        await page.waitForURL('**/blog/');
        await page.getByRole('link',{name:'Daniel, home',exact:true}).tap();
        await page.waitForURL(base+'/');
      });
      report.checks.push(result);
      console.log(JSON.stringify({width,height,failures:result.failures,smallTargets:result.layout.smallTargets.length,nav:result.layout.nav}));
      await context.close();
    }
  } finally {await browser.close();}
  report.passed=report.checks.every(c=>!c.failures.length)&&!report.errors.length&&!report.failedAssets.length;
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  if(!report.passed) process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
