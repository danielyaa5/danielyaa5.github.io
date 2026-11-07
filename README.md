# Daniel’s portfolio

A static portfolio hosted on GitHub Pages. The site uses HTML, CSS, and a small script for the About dialog, with no build step. Its only outside script is PostHog's, for anonymous page views on the published site (see Analytics).

The cream and green layout and illustrations follow the selected Quiet Utility mockup. Illustration files are stored locally in `assets/illustrations/` so the published page does not depend on temporary Canva links.

The artwork uses high-resolution WebP files with transparency. The tree favicon has a separate 128-pixel PNG. The chain, App Store, and Chrome icons are from Tabler Icons; their shared license is stored in `assets/illustrations/link-LICENSE.txt`.

## Preview

Run `python3 -m http.server 4173` from the repository and open `http://localhost:4173`.

## Check

With Playwright installed, run `node tests/portfolio.cjs http://localhost:4173`. The focused checks cover project content, description-first typography, navigation, and horizontal overflow on desktop and mobile.

Before finishing any layout change, run `node tests/frame.cjs http://localhost:4173`. It loads the page at 1920, 1650, 1440, 1280, 1024, 900, 768, 600, 414, 375 and 320 px and fails if a block leaves the frame, touches or extends past the vertical line beside the hero, scrolls sideways, crowds the navigation or wraps the hero buttons. It saves a full-page screenshot per width to `test-results/`; look through them too.

For artwork changes, run `node tests/artwork.cjs http://localhost:4173`. This checks image resolution at 2× display density, chain-icon alignment and spacing, mobile fit, and the favicon. Screenshots and the report are saved to the ignored `test-results/` directory.

## Resume

`resume/` is the web version of the resume, with the portfolio frame and a large download button for `assets/Daniel_Yakobian_Resume.pdf`. The navigation's Resume link opens it. The page repeats the PDF's wording, so when the resume changes, replace the PDF and update `resume/index.html` together.

After changing either, run `node tests/resume.cjs http://localhost:4173`. At 11 widths it checks that the download button is at least 64 px tall and in the first screen, that nothing leaves the frame or scrolls sideways, that the mobile dock doesn't cover the button, and that the PDF links resolve. With `pdftotext` installed it also checks that every bullet on the page appears in the PDF. Screenshots go to `test-results/resume-*.png`.

## Search and link previews

`danielyakobian.com` is the main address. Vercel serves it from this repository, and GitHub Pages serves the same files at `danielyaa5.github.io`, so every page names its `danielyakobian.com` address as canonical and in `og:url`. `vercel.json` permanently redirects `www.danielyakobian.com` and `danielyakobian-com.vercel.app` there. Don't add a custom domain to GitHub Pages: it would redirect the project sites under `danielyaa5.github.io`, including Beckon's update feed.

- `sitemap.xml` lists the pages on `danielyakobian.com`. Add new blog posts there and to the structured data in `blog/index.html`.
- `sitemap-projects.xml` lists the project sites under `danielyaa5.github.io`, because a sitemap may only list addresses on its own host.
- The structured data in `index.html` lists the same projects as the cards. Change both together.
- `assets/social-card.png` is the link preview image. Its source is `assets/social/social-card.html`; render it at 1200×630.

After changing pages, sitemaps or structured data, run `node tests/seo.cjs http://localhost:4173`. It checks robots.txt, canonical addresses, structured data, preview images, the redirects, and that every post is in the sitemap.

## Analytics

`analytics.js` counts page views, link clicks and email sign-ups with PostHog's US cloud in cookieless mode: no cookies or browser storage, no person profiles, no session recordings. It runs only on `danielyakobian.com` and `danielyaa5.github.io`, never on local previews. Addresses on this site are sent without their query string or fragment; campaign tags such as `utm_source` are kept as their own properties. The guest gate page (`gate/`) and QuickDesk's privacy policy don't load it. New pages add `<script src="/analytics.js?v=3" defer></script>` to their `<head>`; raise the `v` number on every page when `analytics.js` changes so browsers fetch the new copy.

Every link opened from a project tile on the home page also sends a `project_click` event with these properties:

- `project`: the tile's project name, such as `Cloud Media Shrinker`
- `link`: `title` for the project name, `button` for the tile's store, GitHub or Explore link, `stars` for the GitHub star badge
- `link_text` and `destination`: the link's words and address
- `section` and `position`: `featured` or `other`, and the tile's place in that section, counting from 1
- `filter`: for Other projects tiles, the filter that was on (`all`, `mac`, `ios`, `web`, `developer` or `printing`)

Middle-clicks count too; opening a link from the right-click menu doesn't. The **Project tile clicks** insight in PostHog charts these events by project.

The PostHog project must keep **Settings > Project > Web analytics > Enable cookieless tracking** on, or PostHog drops these events. The project token in `analytics.js` is public by design. Cookieless mode has no country data, and a visitor who returns on another day counts as a new visitor.

After changing analytics or adding a page, run `node tests/analytics.cjs http://localhost:4173`. It checks which pages load the script, then simulates the published host with PostHog's real script, intercepts its requests so nothing is sent, and checks the page view, its cleaned address, a `project_click` from a featured and a filtered tile and the email sign-up events at phone, tablet and desktop widths, and the untracked gate page. Set `POSTHOG_ARRAY_JS` to a local copy of PostHog's `array.js` if its CDN is unreachable.

## Email sign-up

Below Featured projects, visitors can sign up for emails about new app launches, beta tester invites (try apps early and get them free for life) and promos. The form posts to `api/subscribe.js`, a Vercel function served at `danielyakobian.com/api/subscribe/`. GitHub Pages can't run it, so the copy on `danielyaa5.github.io` posts to `danielyakobian.com` too; the function allows both origins. Without JavaScript the form still posts, and the function sends the browser back to a `#signup-thanks` or `#signup-failed` message.

Sign-ups are stored as contacts in Resend. Each box is a Resend topic (**New app launches**, **Beta tester invites**, **Promos**), created by the function on first use with an opt-out default, so a contact only gets the topics they ticked. Send to a topic by choosing it in a Resend broadcast; recipients can change topics from the unsubscribe link in every broadcast. Signing up again with the same address adds the newly ticked topics and turns email back on. A hidden `company` field catches bots.

The function needs `RESEND_API_KEY`, a Resend API key with full access, set in the Vercel project's environment variables for Production and Preview. Without it the form tells visitors sign-ups aren't open yet. Sending broadcasts from `danielyakobian.com` also needs the domain verified in Resend.

A successful sign-up sends an `email_signup` PostHog event with `topics`, `topic_count` and a true/false property per topic (`new_apps`, `beta`, `promos`); a failed one sends `email_signup_failed` with an `error` code. The address is never sent to PostHog.

After changing the form, run `node tests/signup.cjs http://localhost:4173`. At 13 widths it checks that the form sits between Featured projects and Other projects, lines up with the tiles, stays in its card and has 44-pixel touch targets, then fills it in against a fake function: empty and topic-less sign-ups, a successful one, each error message, and the no-JavaScript path. Screenshots go to `test-results/signup-*.png`. After changing the function, run `node tests/subscribe-api.cjs`, which runs it against a fake Resend API.

## Publish

GitHub Pages publishes the root of the `main` branch, and Vercel deploys the same branch to `danielyakobian.com`. Update `index.html` and `styles.css`, verify the affected layout, and push to `main`.
