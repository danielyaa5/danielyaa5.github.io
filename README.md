# Daniel’s portfolio

A static portfolio hosted on GitHub Pages. The site uses plain HTML and CSS, with no build step or external runtime dependencies.

The cream and green layout and illustrations follow the selected Quiet Utility mockup. Illustration files are stored locally in `assets/illustrations/` so the published page does not depend on temporary Canva links.

## Preview

Run `python3 -m http.server 4173` from the repository and open `http://localhost:4173`.

## Check

With Playwright installed, run `node tests/portfolio.cjs http://localhost:4173`. The focused checks cover project content, description-first typography, navigation, and horizontal overflow on desktop and mobile.

## Publish

GitHub Pages publishes the root of the `main` branch. Update `index.html` and `styles.css`, verify the affected layout, and push to `main`.
