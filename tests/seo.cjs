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
  // The app pages moved from danielyaa5.github.io project sites to danielyakobian.com, so only one sitemap is left.
  assert.equal(robots.match(/^Sitemap:/gm).length, 1);
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
    // Every post links to related posts, keeps search titles short and says when it last changed.
    const post = fs.readFileSync(path.join(root, 'blog', file), 'utf8');
    const related = [...post.matchAll(/<article class="related-card">[\s\S]*?<h3><a href="([^"]+)">/g)].map(m => m[1]);
    assert.ok(related.length >= 2, `blog/${file} has a Keep reading section`);
    for (const link of related) assert.ok(fs.existsSync(path.join(root, 'blog', link)) && link !== file, `blog/${file} links to another real post (${link})`);
    assert.ok(attr(post, /<title>([^<]+)<\/title>/).length <= 90, `blog/${file} title is short enough for search results`);
    const article = jsonLd(post).flatMap(node => node['@graph'] || [node]).find(node => node['@type'] === 'BlogPosting');
    assert.ok(article.dateModified >= article.datePublished, `blog/${file} has dateModified`);
  }
  // Extensionless post links (/blog/slug/) land on the .html post instead of a 404.
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).redirects.some(rule => rule.source === '/blog/:slug([a-z0-9-]+)/' && rule.destination === '/blog/:slug.html' && rule.permanent));

  const home = await get(`${base}/`);
  const graph = jsonLd(home)[0]['@graph'];
  const person = graph.find(node => node['@type'] === 'Person');
  assert.equal(person.name, 'Daniel Yakobian');
  assert.deepEqual(person.sameAs, ['https://github.com/danielyaa5', 'https://www.linkedin.com/in/danielyakobian/']);
  const listed = graph.find(node => node['@type'] === 'ItemList').itemListElement.map(entry => entry.item);
  const cards = [...home.matchAll(/<a class="project-name" href="([^"]+)">([^<]+)<\/a>/g)].map(m => ({ url: m[1], name: m[2] }));
  assert.equal(cards.length, 17);
  assert.deepEqual(listed.map(item => ({ url: item.url, name: item.name })), cards, 'structured data matches the project cards');
  // A project page on this site is in the sitemap; GitHub Pages project sites now only forward here.
  for (const card of cards.filter(card => card.url.startsWith(`${site}/`))) {
    assert.ok(pages.includes(card.url), `${card.url} is in sitemap.xml`);
  }
  assert.ok(!cards.some(card => card.url.startsWith('https://danielyaa5.github.io/')), 'no project card points at a GitHub Pages project site');

  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const hostRedirects = vercel.redirects.filter(rule => rule.has?.[0]?.type === 'host');
  const hosts = hostRedirects.map(rule => rule.has[0].value);
  assert.deepEqual(hosts, ['www.danielyakobian.com', 'danielyakobian-com.vercel.app', 'cloudmediashrinker.com', 'www.cloudmediashrinker.com']);
  // `/:path*` would not match `/` or paths ending in `/`, so the redirects capture the whole path.
  // The site's own hosts keep the path as is; cloudmediashrinker.com sends every path to the same path under the app's page.
  const siteHosts = ['www.danielyakobian.com', 'danielyakobian-com.vercel.app'];
  assert.ok(hostRedirects.every(rule => rule.permanent && rule.source === '/:path(.*)'));
  assert.ok(hostRedirects.every(rule => rule.destination === (siteHosts.includes(rule.has[0].value) ? `${site}/:path` : `${site}/cloud-media-shrinker/:path`)));
  // Like GitHub Pages, send /blog to /blog/ so the page's relative links resolve.
  assert.equal(vercel.trailingSlash, true);

  console.log(JSON.stringify({ passed: true, pages }));
})().catch(error => { console.error(error); process.exitCode = 1; });
