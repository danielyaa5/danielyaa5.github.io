# Daniel’s portfolio

A static portfolio hosted on GitHub Pages. The site uses HTML, CSS, and a small script for the About dialog, with no build step or external runtime dependencies.

The cream and green layout and illustrations follow the selected Quiet Utility mockup. Illustration files are stored locally in `assets/illustrations/` so the published page does not depend on temporary Canva links.

The artwork uses high-resolution WebP files with transparency. The tree favicon has a separate 128-pixel PNG. The chain icon is from Tabler Icons; its license is stored beside the SVG.

## Preview

Run `python3 -m http.server 4173` from the repository and open `http://localhost:4173`.

## Check

With Playwright installed, run `node tests/portfolio.cjs http://localhost:4173`. The focused checks cover project content, description-first typography, navigation, and horizontal overflow on desktop and mobile.

Before finishing any layout change, run `node tests/frame.cjs http://localhost:4173`. It loads the page at 1920, 1650, 1440, 1280, 1024, 900, 768, 600, 414, 375 and 320 px and fails if a block leaves the frame, touches or extends past the vertical line beside the hero, scrolls sideways, crowds the navigation or wraps the hero buttons. It saves a full-page screenshot per width to `test-results/`; look through them too.

For artwork changes, run `node tests/artwork.cjs http://localhost:4173`. This checks image resolution at 2× display density, chain-icon alignment and spacing, mobile fit, and the favicon. Screenshots and the report are saved to the ignored `test-results/` directory.

## Search and link previews

`danielyakobian.com` is the main address. Vercel serves it from this repository, and GitHub Pages serves the same files at `danielyaa5.github.io`, so every page names its `danielyakobian.com` address as canonical and in `og:url`. `vercel.json` permanently redirects `www.danielyakobian.com` and `danielyakobian-com.vercel.app` there. Don't add a custom domain to GitHub Pages: it would redirect the project sites under `danielyaa5.github.io`, including Beckon's update feed.

- `sitemap.xml` lists the pages on `danielyakobian.com`. Add new blog posts there and to the structured data in `blog/index.html`.
- `sitemap-projects.xml` lists the project sites under `danielyaa5.github.io`, because a sitemap may only list addresses on its own host.
- The structured data in `index.html` lists the same projects as the cards. Change both together.
- `assets/social-card.png` is the link preview image. Its source is `assets/social/social-card.html`; render it at 1200×630.

After changing pages, sitemaps or structured data, run `node tests/seo.cjs http://localhost:4173`. It checks robots.txt, canonical addresses, structured data, preview images, the redirects, and that every post is in the sitemap.

## Publish

GitHub Pages publishes the root of the `main` branch, and Vercel deploys the same branch to `danielyakobian.com`. Update `index.html` and `styles.css`, verify the affected layout, and push to `main`.
