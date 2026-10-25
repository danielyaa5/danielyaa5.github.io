# Mobile navigation and touch-target verification

Date: October 25, 2026. Scope: the two findings from the mobile QA of production commit `65fd0ed`.

## Changes

- Phone navigation now sits below the identity row, uses 15-pixel text, and becomes a deliberate three-column/two-row grid at widths of 480 pixels and below. The shop link spans two cells. Every label stays on one line. Wider layouts retain inline navigation.
- Navigation and identity links have at least 44 × 44-pixel hit areas.
- The PUML star anchor is at least 44 pixels high; an inner badge preserves the small visible pill. The transparent edges belong to the same stargazers link.
- Footer links, including Back to top, have at least 44 × 44-pixel hit areas without increasing their text size.
- Shared styles are versioned on the home page and all three blog pages so returning visitors receive the fixes.

## Local verification

- `tests/mobile.cjs`: all ten configurations passed, including portrait widths 320, 360, 375, 390, 393, 412 and 430 pixels, landscape 667 × 375 and 844 × 390, and tablet 768 × 1024.
- New regression checks verify readable navigation, single-line labels, 44-pixel hit areas, and that the top/bottom/left/right edges of the targets receive input without another link covering them.
- At 390 pixels the star target measured about 52 × 44, Back to top 44 × 44, and profile links 44 pixels high. All tested hit-area edges resolved to their correct anchors.
- Touch filters/counts, shop tile hit area, section navigation, About opening/closing and internal scrolling, blog/article/home navigation passed. No page exceptions, missing visible images or failing same-site HTTP responses were recorded.
- `tests/frame.cjs`: passed all eleven widths, 1920 through 320 pixels. The name/navigation spacing check now handles both inline and stacked header layouts. Full-page captures were reviewed in wide and narrow comparison sheets.
- `tests/portfolio.cjs`: passed seven widths, including the newly centered star-link hit area and existing project flows.
- `tests/stars.cjs`: passed live-response mocks, API/network failures, invalid data, JavaScript disabled and responsive fit.
- `tests/seo.cjs`: passed.
- `tests/artwork.cjs`: its image-count expectation was updated for the current nine images. The existing `buy-or-rent.webp` source-resolution assertion still fails at 2×; that asset was not changed by this fix. Mobile image loading passed independently. This existing artwork issue does not affect either repaired interaction.

Local captures are under `test-results/mobile-fixed-local/`; frame comparisons are `test-results/mobile-fix-wide.png` and `test-results/mobile-fix-narrow.png`. Production verification is recorded separately after deployment.

## Reproduction

With Playwright available in the Node environment:

```sh
node tests/mobile.cjs http://localhost:4173
node tests/frame.cjs http://localhost:4173
node tests/portfolio.cjs http://localhost:4173
node tests/stars.cjs http://localhost:4173
node tests/seo.cjs http://localhost:4173
```

The same commands accept the public site URL after deployment. `PLAYWRIGHT_CHANNEL=chrome` selects installed Chrome. `MOBILE_QA_OUTPUT` chooses the evidence folder; `MOBILE_QA_SIZES` accepts a JSON array of width/height pairs for focused reruns.

## Coverage limits

Verification used headless Chromium with mobile viewport and touch emulation, not a physical phone or iOS Safari. Native text enlargement, pinch zoom, screen readers and third-party checkout remain outside these checks. The changes require no new JavaScript or mobile-menu toggle.
