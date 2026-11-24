// Cloud Media Shrinker's download count, rounded down to the hundred. The page ships with a number baked in; this
// swaps in the latest one from downloads.json, and only ever a higher one, so the count never goes backwards.
(() => {
  const counts = document.querySelectorAll('[data-cms-downloads]');
  if (!counts.length) return;
  fetch('/cloud-media-shrinker/downloads.json', { cache: 'no-cache', credentials: 'omit', signal: AbortSignal.timeout(4000) })
    .then(response => (response.ok ? response.json() : null))
    .then(data => {
      const rounded = data && data.rounded;
      if (!Number.isSafeInteger(rounded) || rounded <= 0 || rounded % 100) return;
      for (const count of counts) {
        if (rounded <= Number(count.dataset.cmsDownloads)) continue;
        count.dataset.cmsDownloads = String(rounded);
        count.querySelector('[data-downloads-number]').textContent = `${rounded.toLocaleString('en-US')}+`;
      }
    })
    .catch(() => {
      // Keep the number baked into the page.
    });
})();
