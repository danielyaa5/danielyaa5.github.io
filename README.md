# Daniel’s portfolio

A static portfolio hosted on GitHub Pages. The site uses HTML, CSS, and a small script for the About dialog, with no build step. Its only outside script is PostHog's, for anonymous page views on the published site (see Analytics).

The cream and green layout and illustrations follow the selected Quiet Utility mockup. Illustration files are stored locally in `assets/illustrations/` so the published page does not depend on temporary Canva links.

The artwork uses high-resolution WebP files with transparency. The pages load smaller display copies named after the width, such as `hero-800.webp`, so phones don't download 1,500-pixel art for a 240-pixel slot. Make one with `python3 tools/resize-image.py assets/illustrations/<name>.webp <width>`, choosing the larger of twice the widest size the art is shown at on desktop and three times the widest on phones, and keep the full-size file as the source (the social card uses it). Give the page's main image `fetchpriority="high"` and art below the first screen `loading="lazy"`. The home hero also has an AVIF copy (`hero-800.avif`, about half the size) in a `<picture>`, with the WebP as the fallback; the Pillow that ships with recent Python saves AVIF with `image.save(path, 'AVIF', quality=60)`. The tree favicon has a separate 128-pixel PNG. The chain, App Store, and Chrome icons are from Tabler Icons; their shared license is stored in `assets/illustrations/link-LICENSE.txt`.

## Preview

Run `python3 -m http.server 4173` from the repository and open `http://localhost:4173`.

## Check

With Playwright installed, run `node tests/portfolio.cjs http://localhost:4173`. The focused checks cover project content, description-first typography, navigation, and horizontal overflow on desktop and mobile.

Before finishing any layout change, run `node tests/frame.cjs http://localhost:4173`. It loads the page at 1920, 1650, 1440, 1280, 1024, 900, 768, 600, 414, 375 and 320 px and fails if a block leaves the frame, touches or extends past the vertical line beside the hero, scrolls sideways, crowds the navigation or wraps the hero buttons. It saves a full-page screenshot per width to `test-results/`; look through them too.

For artwork changes, run `node tests/artwork.cjs http://localhost:4173`. This checks image resolution at 2× display density, chain-icon alignment and spacing, mobile fit, and the favicon. Screenshots and the report are saved to the ignored `test-results/` directory.

## Resume

`resume/` is the web version of the resume, with the portfolio frame and a large download button for `assets/Daniel_Yakobian_Resume.pdf`. The navigation's Resume link opens it. The page repeats the PDF's wording, so when the resume changes, replace the PDF and update `resume/index.html` together.

After changing either, run `node tests/resume.cjs http://localhost:4173`. At 11 widths it checks that the download button is at least 64 px tall and in the first screen, that nothing leaves the frame or scrolls sideways, that the mobile dock doesn't cover the button, and that the PDF links resolve. With `pdftotext` installed it also checks that every bullet on the page appears in the PDF. Screenshots go to `test-results/resume-*.png`.

## Motorcycle rentals

`motorcycle-rentals/` lists the motorcycles Daniel rents out, one tile per bike, with booking links to each bike's listing on Riders Share and, where it's listed, Twisted Road. The navigation's Motorcycle Rentals link opens it. Riders Share links are the listing's **Share** link, which carries Daniel's referral code, not the plain listing address. A referral card under the intro links to sign-up on both sites with Daniel's referral codes: his Riders Share profile with `/ref-` plus the code (any Riders Share page with that suffix sets the referral cookie) and his Twisted Road invite link (`twistedroad.com/ref/` plus the code). Bike photos are stored in `assets/motorcycles/` as WebP so the page doesn't depend on the rental sites' image hosts. Keep each photo's color profile when converting (iPhone photos are Display P3 and look washed out without it), and bump the `?v=` on an image's address when you replace it. `python3 tools/resize-image.py assets/motorcycles/<photo>.webp --replace` re-encodes a photo at quality 80 and keeps its size and color profile; the photos are 1440 pixels wide, enough for 3× phone screens.

To add or change a bike, copy one `<article class="bike">` block in `motorcycle-rentals/index.html`, add its entry to the page's structured data, and keep `data-platform` (`riders_share` or `twisted_road`) on each booking link. On phones and narrow tablets the navigation shows short labels (Shop, Rentals); the full names stay in each link's `aria-label`.

After changing the page or the navigation, run `node tests/rentals.cjs http://localhost:4173`. At 14 widths it checks that every bike has a sharp photo with alt text and a Riders Share link with a referral code, that the referral card links to both sites with the referral codes, that booking and referral buttons are full touch targets on one line, that nothing leaves the frame or scrolls sideways, and that the phone dock never covers a button. Screenshots go to `test-results/rentals-*.png`. Each Riders Share or Twisted Road link on the page also sends a `rental_click` PostHog event with `bike`, `platform` (`riders_share` or `twisted_road`), `link_text`, `destination` and `position`; the profile links at the top send `bike: All bikes` and position 0.

## Blog

Every post lives in `blog/` on this site, with its images in `assets/writing/` (a folder per post when it has several). Home Writings and the All writing list (`blog/index.html`) link to these pages, never to a project site. Three posts used to be served elsewhere and now only forward here: the H2D exhaust fan post (`h2d-custom-dashboard` repo, `docs/index.html`), the gate widget post (`gate-opener-widget` repo, `docs/index.html`) and the AI Trader write-up (the `ai-trader-writeup` repo's README, which links here). Edit the copy in this repository.

## Dark mode

The site follows the visitor's system setting. Light colors stay where they are in each stylesheet; a `@media screen and (prefers-color-scheme: dark)` block at the end of `styles.css` (and of `blog/blog.css`, `resume/resume.css` and `motorcycle-rentals/rentals.css`) swaps them for the forest-night palette: page `#0e1511`, cards `#17221b`, cream text `#ebe8da`, mint links `#98d4a8` and green filled buttons `#2a6b47`. In dark mode `--green` is the text accent, so anything filled uses `--fill` instead. Print stays light.

The illustrations aren't duplicated. The `--line-art` CSS filter turns their dark outlines and cream fills into quiet sage line art, and it applies to the hero, project and featured art, the tree and any image with the `line-art` class (illustrated blog thumbnails and covers; leave screenshots and photos without it). Art drawn on a white square instead of transparency gets `art-on-white`, which multiplies in light mode and lightens in dark mode. The Tabler icons are recolored with a filter.

A new page needs `<meta name="color-scheme" content="light dark">` and the two `theme-color` tags (light `#fdfaf3`, dark `#0e1511`), and any colors its own stylesheet sets need a dark version. Check new work with Playwright's `colorScheme: 'dark'` as well as light.

## Search and link previews

`danielyakobian.com` is the main address. Vercel serves it from this repository, and GitHub Pages serves the same files at `danielyaa5.github.io`, so every page names its `danielyakobian.com` address as canonical and in `og:url`. `vercel.json` permanently redirects `www.danielyakobian.com` and `danielyakobian-com.vercel.app` there. Don't add a custom domain to GitHub Pages: it would redirect the project sites under `danielyaa5.github.io`, including Beckon's update feed.

- `sitemap.xml` lists the pages on `danielyakobian.com`. Add new blog posts there and to the structured data in `blog/index.html`.
- `sitemap-projects.xml` lists the project sites under `danielyaa5.github.io`, because a sitemap may only list addresses on its own host.
- The structured data in `index.html` lists the same projects as the cards. Change both together.
- `assets/social-card.png` is the link preview image. Its source is `assets/social/social-card.html`; render it at 1200×630.

After changing pages, sitemaps or structured data, run `node tests/seo.cjs http://localhost:4173`. It checks robots.txt, canonical addresses, structured data, preview images, the redirects, and that every post is in the sitemap.

## Analytics

`analytics.js` counts page views, link clicks, resume downloads and email sign-ups, and measures page speed (web vitals), with PostHog's US cloud in cookieless mode: no cookies or browser storage, no person profiles, no session recordings. It runs only on `danielyakobian.com` and `danielyaa5.github.io`, never on local previews. Addresses on this site are sent without their query string or fragment, including the ones inside web vitals and link click details; campaign tags such as `utm_source` are kept as their own properties. The guest gate page (`gate/`) and QuickDesk's privacy policy don't load it. New pages add `<script src="/analytics.js?v=6" defer></script>` to their `<head>`; raise the `v` number on every page when `analytics.js` changes so browsers fetch the new copy.

Every link opened from a project tile on the home page also sends a `project_click` event with these properties:

- `project`: the tile's project name, such as `Cloud Media Shrinker`
- `link`: `title` for the project name, `button` for the tile's store, GitHub or Explore link, `stars` for the GitHub star badge
- `link_text` and `destination`: the link's words and address
- `section` and `position`: `featured` or `other`, and the tile's place in that section, counting from 1
- `filter`: for Other projects tiles, the filter that was on (`all`, `mac`, `ios`, `web`, `developer` or `printing`)

Middle-clicks count too; opening a link from the right-click menu doesn't. The **Project tile clicks** insight in PostHog charts these events by project.

Every click on a link to the resume PDF sends a `resume_download` event with `button` (`top` for the button under the name on `resume/`, `scroll_bar` for the one in the bar that slides in on scroll, `end` for the one in the last section, `other` for any other resume PDF link), `link_text` and `destination`. Middle-clicks count too. Opening the PDF's address directly, or from the right-click menu, isn't counted. The **Resume downloads** insight in PostHog charts these events by button.

The PostHog project must keep **Settings > Project > Web analytics > Enable cookieless tracking** on, or PostHog drops these events. The project token in `analytics.js` is public by design. Cookieless mode has no country data, and a visitor who returns on another day counts as a new visitor.

After changing analytics or adding a page, run `node tests/analytics.cjs http://localhost:4173`. It checks which pages load the script, then simulates the published host with PostHog's real script, intercepts its requests so nothing is sent, and checks the page view, its cleaned address, the web vitals event and the addresses inside it, a `project_click` from a featured and a filtered tile and the email sign-up events at phone, tablet and desktop widths, and the untracked gate page. Set `POSTHOG_ARRAY_JS` to a local copy of PostHog's `array.js` if its CDN is unreachable (`npm pack posthog-js` and use `package/dist/array.js`); the test serves the web vitals script from the same folder.

## Monitoring

- **Page speed:** `analytics.js` sends PostHog's `$web_vitals` event (LCP, INP, CLS and FCP, with the element behind a slow LCP or INP). See them per page under **Web analytics > Web vitals** in PostHog. With a few dozen visits a week, give the numbers a few weeks before reading much into them.
- **Uptime:** `.github/workflows/uptime.yml` runs `.github/scripts/uptime.cjs` every 15 minutes. It checks the home, resume, rentals and blog pages, `analytics.js`, that the sign-up function answers a GET with its 405, the `www` redirect, the TLS certificate (at least 14 days left) and the GitHub Pages copy, retrying a failed check twice 20 seconds apart. When a check still fails it opens a **Site check failed** issue that mentions `@danielyaa5`, so GitHub emails the owner; the issue's table is updated while checks keep failing, and it gets a "Back up" comment and closes itself once they all pass. Run the workflow by hand with **test_alert** ticked to check that the issue and email arrive; the next scheduled run closes the test issue. GitHub turns scheduled workflows off after 60 days without commits to the repository, and may start a run a few minutes late. `node .github/scripts/uptime.cjs` runs the same checks from a terminal without touching issues.
- **Alerts in PostHog** (emailed to the owner): **Failed email sign-ups** fires on any `email_signup_failed` in a day other than a mistyped address, and **Slow page loads (LCP p75)** fires when the week's 75th-percentile LCP is over 2.5 seconds. The free plan allows 5 alerts per organization.

## Email sign-up

Below Featured projects, visitors can sign up for emails about beta tester invites (try apps early and get them free for life), new app and open source launches, and promos. The form posts to `api/subscribe.js`, a Vercel function served at `danielyakobian.com/api/subscribe/`. GitHub Pages can't run it, so the copy on `danielyaa5.github.io` posts to `danielyakobian.com` too; the function allows both origins. Without JavaScript the form still posts, and the function sends the browser back to a `#signup-thanks` or `#signup-failed` message.

After a successful sign-up the section shrinks to one line, "Signup success!", with an **Edit email** button that brings the form back. The browser keeps a `signup-done` entry in local storage with the ticked topics (never the address) so the section stays small on later visits; Edit email removes it. Nothing in it is sent anywhere.

Sign-ups are stored as contacts in Resend. Each box is a Resend topic (**Beta tester invites**, **New app and open source launches**, **Promos**), created by the function on first use with an opt-out default, so a contact only gets the topics they ticked. To rename a topic, change its `name` in `api/subscribe.js` and add the old name to `formerly`; the function renames the existing topic so its subscribers stay on it. Send to a topic by choosing it in a Resend broadcast; recipients can change topics from the unsubscribe link in every broadcast. Signing up again with the same address adds the newly ticked topics and turns email back on. A hidden `company` field catches bots.

The function needs `RESEND_API_KEY`, a Resend API key with full access, set in the Vercel project's environment variables for Production and Preview. Without it the form tells visitors sign-ups aren't open yet. Sending broadcasts from `danielyakobian.com` also needs the domain verified in Resend.

A successful sign-up sends an `email_signup` PostHog event with `topics`, `topic_count` and a true/false property per topic (`new_apps`, `beta`, `promos`); a failed one sends `email_signup_failed` with an `error` code. The address is never sent to PostHog.

After changing the form, run `node tests/signup.cjs http://localhost:4173`. At 13 widths it checks that the form sits between Featured projects and Other projects, lines up with the tiles, stays in its card and has 44-pixel touch targets, then fills it in against a fake function: empty and topic-less sign-ups, a successful one with the one-line success state, its reload and Edit email, each error message, and the no-JavaScript path. Screenshots go to `test-results/signup-*.png` and `test-results/signup-done-*.png`. After changing the function, run `node tests/subscribe-api.cjs`, which runs it against a fake Resend API.

## Publish

GitHub Pages publishes the root of the `main` branch, and Vercel deploys the same branch to `danielyakobian.com`. Update `index.html` and `styles.css`, verify the affected layout, and push to `main`.
