const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const root = path.join(__dirname, '..');
const site = 'https://danielyakobian.com';

// Search and AI crawlers read the static HTML, so check what they get: one canonical address per page,
// sitemaps that list only their own host, and structured data that parses and matches the visible projects.
const attr = (html, re) => (html.match(re) || [])[1];
const locs = xml => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const jsonLd = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

(async () => {
  const get = async url => {
    const response = await fetch(url);
    assert.equal(response.status, 200, `${url} returned ${response.status}`);
    return response.text();
  };

  const robots = await get(`${base}/robots.txt`);
  assert.match(robots, /^User-agent: \*\nAllow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/danielyakobian\.com\/sitemap\.xml$/m);
  assert.match(robots, /^Sitemap: https:\/\/danielyaa5\.github\.io\/sitemap-projects\.xml$/m);
  assert.doesNotMatch(robots, /Disallow/);

  const pages = locs(await get(`${base}/sitemap.xml`));
  assert.ok(pages.length >= 3);
  for (const loc of pages) {
    assert.ok(loc.startsWith(`${site}/`), `${loc} is not on ${site}`);
    const html = await get(base + loc.slice(site.length));
    assert.equal(attr(html, /<link rel="canonical" href="([^"]+)">/), loc, `canonical for ${loc}`);
    assert.equal(attr(html, /<meta property="og:url" content="([^"]+)">/), loc, `og:url for ${loc}`);
    assert.match(attr(html, /<title>([^<]+)<\/title>/), /Daniel Yakobian/, `title for ${loc}`);
    assert.ok(jsonLd(html).length >= 1, `structured data for ${loc}`);
    const image = attr(html, /<meta property="og:image" content="([^"]+)">/);
    assert.ok(image?.startsWith(`${site}/`), `og:image for ${loc}`);
    assert.ok(fs.existsSync(path.join(root, image.slice(site.length))), `${image} exists`);
  }

  // A new post needs a sitemap entry and a place in the blog's structured data.
  const posts = jsonLd(await get(`${base}/blog/`))[0].blogPost.map(post => post.url);
  for (const file of fs.readdirSync(path.join(root, 'blog')).filter(name => name.endsWith('.html') && name !== 'index.html')) {
    assert.ok(pages.includes(`${site}/blog/${file}`), `blog/${file} is in sitemap.xml`);
    assert.ok(posts.includes(`${site}/blog/${file}`), `blog/${file} is in the blog structured data`);
  }

  const projects = locs(await get(`${base}/sitemap-projects.xml`));
  assert.ok(projects.every(loc => loc.startsWith('https://danielyaa5.github.io/') && loc.endsWith('/')));

  const home = await get(`${base}/`);
  const graph = jsonLd(home)[0]['@graph'];
  const person = graph.find(node => node['@type'] === 'Person');
  assert.equal(person.name, 'Daniel Yakobian');
  assert.deepEqual(person.sameAs, ['https://github.com/danielyaa5', 'https://www.linkedin.com/in/danielyakobian/']);
  const listed = graph.find(node => node['@type'] === 'ItemList').itemListElement.map(entry => entry.item);
  const cards = [...home.matchAll(/<a class="project-name" href="([^"]+)">([^<]+)<\/a>/g)].map(m => ({ url: m[1], name: m[2] }));
  assert.equal(cards.length, 9);
  assert.deepEqual(listed.map(item => ({ url: item.url, name: item.name })), cards, 'structured data matches the project cards');
  for (const card of cards.filter(card => card.url.startsWith('https://danielyaa5.github.io/'))) {
    assert.ok(projects.includes(card.url), `${card.url} is in sitemap-projects.xml`);
  }

  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const hosts = vercel.redirects.map(rule => rule.has[0].value);
  assert.deepEqual(hosts, ['www.danielyakobian.com', 'danielyakobian-com.vercel.app']);
  // `/:path*` would not match `/` or paths ending in `/`, so the redirects capture the whole path.
  assert.ok(vercel.redirects.every(rule => rule.permanent && rule.source === '/:path(.*)' && rule.destination === `${site}/:path`));
  // Like GitHub Pages, send /blog to /blog/ so the page's relative links resolve.
  assert.equal(vercel.trailingSlash, true);

  console.log(JSON.stringify({ passed: true, pages, projects: projects.length }));
})().catch(error => { console.error(error); process.exitCode = 1; });
