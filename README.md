# Daniel’s portfolio

A static portfolio hosted on GitHub Pages. The site uses HTML, CSS, and a small script for the About dialog, with no build step or external runtime dependencies.

The cream and green layout and illustrations follow the selected Quiet Utility mockup. Illustration files are stored locally in `assets/illustrations/` so the published page does not depend on temporary Canva links.

The artwork uses high-resolution WebP files with transparency. The tree favicon has a separate 128-pixel PNG. The chain icon is from Tabler Icons; its license is stored beside the SVG.

## Preview

Run `python3 -m http.server 4173` from the repository and open `http://localhost:4173`.

## Check

With Playwright installed, run `node tests/portfolio.cjs http://localhost:4173`. The focused checks cover project content, description-first typography, navigation, and horizontal overflow on desktop and mobile.

For artwork changes, run `node tests/artwork.cjs http://localhost:4173`. This checks image resolution at 2× display density, chain-icon alignment and spacing, mobile fit, and the favicon. Screenshots and the report are saved to the ignored `test-results/` directory.

## Publish

GitHub Pages publishes the root of the `main` branch. Update `index.html` and `styles.css`, verify the affected layout, and push to `main`.
