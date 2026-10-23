# Daniel’s portfolio

A static portfolio hosted on GitHub Pages. The site uses HTML, CSS, and a small script for the About dialog, with no build step or external runtime dependencies.

The cream and green layout and illustrations follow the selected Quiet Utility mockup. Illustration files are stored locally in `assets/illustrations/` so the published page does not depend on temporary Canva links.

The artwork uses high-resolution WebP files with transparency. The tree favicon has a separate 128-pixel PNG. The chain icon is from Tabler Icons; its license is stored beside the SVG.

## Preview

Run `python3 -m http.server 4173` from the repository and open `http://localhost:4173`.

## Check

With Playwright installed, run `node tests/portfolio.cjs http://localhost:4173`. The focused checks cover project content, description-first typography, navigation, and horizontal overflow on desktop and mobile.

Before finishing any layout change, run `node tests/frame.cjs http://localhost:4173`. It loads the page at 1920, 1650, 1440, 1280, 1024, 900, 768, 600, 414, 375 and 320 px and fails if a block leaves the frame, touches the vertical line beside the hero, scrolls sideways, crowds the navigation or wraps the hero buttons. It saves a full-page screenshot per width to `test-results/`; look through them too.

For artwork changes, run `node tests/artwork.cjs http://localhost:4173`. This checks image resolution at 2× display density, chain-icon alignment and spacing, mobile fit, and the favicon. Screenshots and the report are saved to the ignored `test-results/` directory.

## Publish

GitHub Pages publishes the root of the `main` branch. Update `index.html` and `styles.css`, verify the affected layout, and push to `main`.
