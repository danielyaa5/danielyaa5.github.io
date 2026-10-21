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
