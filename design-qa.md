# Featured projects layout

Scope: the selected split layout, with Cloud Media Shrinker in the large left tile, puml-for-markdown at upper right and Beckon at lower right. The remaining list is named Other projects and contains eight unique entries, including the Etsy shop tile.

## Source and rendered evidence

- Selected visual: `test-results/featured-selected.png`, 1422 × 1106 pixels. This is a focused section mockup, not a request to enlarge the existing page frame.
- Desktop implementation: `test-results/featured-1440.png`, 950 × 569 pixels, captured from the featured section of the real page at a 1440 × 1000 CSS viewport and 1× density.
- Full-view comparison: `test-results/featured-design-comparison.png`. The source featured region (114, 89) through (1307, 732) is normalized to the implementation's 950-pixel content width, preserving aspect ratio. Both show the same selected arrangement, light theme, unfiltered state and 343-star badge. Section height is content-driven and is not stretched to force a match.
- Focused detail comparison: the full-view comparison is large enough to read titles, badge, descriptions and links directly. Separate detail crops were unnecessary.
- Mobile implementation: `test-results/featured-390.png`, captured at 390 CSS pixels and 1× density.
- Complete-page evidence: `test-results/frame-{width}.png` at 1920, 1650, 1440, 1280, 1024, 900, 768, 600, 414, 375 and 320 CSS pixels. All were inspected for fit and responsive flow.

## Findings and comparison history

1. Initial review: the 290-pixel lead image box and 154-pixel companion boxes made the artwork less prominent than the chosen composition (P2). Increased them to 330 and 170 pixels respectively, retaining source transparency and aspect ratio. The final comparison shows the larger illustration hierarchy.
2. Desktop review: the PUML badge wrapped onto a second line because the title, badge and 9-pixel gap exceeded the available line by less than one pixel (P2). Reduced the gap to 6 pixels. The final screenshot and a regression assertion confirm the badge sits beside the title on desktop. Wrapping remains intentional on narrow screens.
3. Final comparison: no actionable P0/P1/P2 findings remain. The large-left / two-stacked-right arrangement, project identities, star placement, green-and-cream palette and Other projects separation match the selected direction.

## Required fidelity surfaces

- Fonts and typography: retained the existing Arial/Helvetica stack and established heading scale; the lead title is 28 pixels, companion titles 18 pixels and descriptions 16–18 pixels. Text remains editable, readable and unclipped. Small differences from raster lettering are intentional to preserve the website's typography.
- Spacing and layout rhythm: retained the existing page frame and rail alignment. The two-column featured grid has a 14-pixel gap and aligned outer edges. It stacks in reading order on narrower screens. Actual content and 44-pixel link targets determine card height; the mockup's page magnification does not replace the site's frame size.
- Colors and tokens: retained paper `#fdfaf3`, ink `#111810`, green `#124b30`, featured fill `#edf1e3`, border `#a7b2a5` and 6-pixel corner radii.
- Image quality and asset fidelity: reused the original high-resolution transparent project illustrations, without stretching or replacing them with approximate drawings. The featured artwork supports 2× display density. The original artwork's small differences from the layout mock are intentional. Unrelated existing Buy or Rent artwork resolution remains outside this change.
- Copy and content: Cloud Media Shrinker, puml-for-markdown and Beckon occur once each in featured. Other projects has eight entries, no duplicates and accurate project descriptions. The structured data follows the new visible order. Existing writing cards remain intact.

## Behavior and checks

- Portfolio checks passed at seven widths, including filter results, singular/plural counts, keyboard selection, About dialog, writing navigation, back-to-top navigation, image loading, featured image density and content fit.
- Frame checks passed at all eleven widths, including horizontal overflow, page frame and rail alignment.
- Star checks passed with a live response, rate limiting, network errors, invalid data and JavaScript disabled. The star badge is a separate stargazers link without nested anchors.
- SEO and structured-data checks passed.
- In the in-app browser, followed the Cloud Media Shrinker project link to its landing page, returned, selected Developer tools (one project), and restored All (seven projects). No warning or error console entries were observed.

## Etsy tile and introduction follow-up

- Updated the hero introduction with the owner-provided wording and bold company names: Snapchat, Clutter and Tinder.
- Header navigation now says 3D Print Shop and points to UrbanTechGoods on Etsy. The hero GitHub button remains available.
- Added a transparent Canva illustration and a 3D prints for sale tile in the printing category. The title, footer and tile surface link to the shop. Printing now contains three entries; All contains eight.
- Portfolio checks passed at seven widths and frame checks at eleven widths after these changes. SEO checks passed with the Store entry in structured data.
- In the in-app browser, inspected the bold names, selected 3D printing, confirmed three entries and followed the new shop title. It reached the correct Etsy shop URL; Etsy displayed a device check in the in-app browser. The shop itself was separately inspected in the signed-in browser.
- Local screenshot evidence: `test-results/portfolio-intro-shop.png` and `test-results/3d-printing-shop-tile.png`. Publication remains pending.

## Follow-up polish

No blocking polish remains. The site's existing artwork and typography are preserved rather than tracing raster details. Publication and the owner's review are pending; this report covers the local implementation.

final result: passed

---

## Previous artwork verification

# Artwork correction

Scope: the chain icon and illustration sharpness. This is a focused visual check.

## Source and evidence

- Source: the selected Quiet Utility artwork and the previous implementation capture, `test-results/portfolio-1440.png`.
- Desktop implementation: `test-results/artwork-1440.png`; 1440 CSS pixels wide, captured at 2× density (2880 pixels).
- Mobile implementation: `test-results/artwork-390.png`; 390 CSS pixels wide, captured at 2× density (780 pixels).
- Full-view comparison: `test-results/artwork-comparison.png`; old and new desktop captures normalized to the same 1440-pixel CSS width and top-of-page state. The old capture has a keyboard focus outline on About; this is a state difference, not a layout difference.
- Focused image-quality comparison: `test-results/hero-comparison.png`; the original and replacement hero rendered side by side at the same size.
- Measurements: `test-results/artwork-report.json`.

## Findings and corrections

1. The chain PNG contained uneven padding, making its visible mark sit low beside the URL. Replaced it with the Tabler link SVG, removed the negative margin, and set a consistent 14-pixel box and 6-pixel gap. Every project and profile link passes the check that icon and text centers differ by less than half a pixel at both widths.
2. The original hero was 366 pixels wide and the project images were only 82–164 pixels wide. The replacement transparent artwork is over 1100 pixels wide per illustration, retaining the original subjects and muted forest/sage palette. A comparison confirmed crisp edges at the website's displayed sizes. The restored artwork has cleaner contours and small detail differences from the low-resolution originals; it preserves their subjects and placement.
3. The small tree emblem was also replaced, and a dedicated 128-pixel PNG favicon is linked from the page.

## Required visual surfaces

- Typography: unchanged; the subtitle/benefit hierarchy and text wrapping remain consistent.
- Spacing and layout: the original grid, image slots, card padding, and controls are retained. Chain spacing is corrected. Neither desktop nor mobile overflows horizontally.
- Colors: page and card tokens are unchanged. Artwork remains ivory, forest green, and desaturated sage.
- Image quality: the new art supports at least 2× the displayed image width. All images load; the link icon is a vector. No tracing trial was included in the site.
- Copy: names, descriptions, project order, and navigation copy are unchanged.

## Comparison history

- Initial: low-resolution artwork and off-center visible chain mark were actionable visual issues.
- Trial: automatic tracing created distorted curves and background blobs. Rejected before integration.
- Final: high-resolution redraws and a balanced vector chain were installed, then captured and compared on desktop and mobile. The focused resolution, alignment, load, fit, favicon, and page-error checks passed.

final result: passed
