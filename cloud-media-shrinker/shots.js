// The feature screenshots on the product page (styles in shots.css). Each one links to its full-size file.
// - With a mouse, hovering zooms in where the pointer is.
// - On a screen wider than 850px, a click opens a full-screen viewer (arrows to move, Esc, the close button, a click on
//   the dark area or Back to close).
// - At 850px and narrower the screenshots already fill the column, so a viewer would barely enlarge them: a click or tap
//   just follows the link and the browser shows the image on its own, where a phone can pinch to zoom.
// Clicks with a modifier key or the middle button keep their usual meaning, such as opening the image in a new tab.
(() => {
  const links = [...document.querySelectorAll('.c-feature a.c-zoom')];
  if (!links.length) return;
  const mouse = matchMedia('(hover: hover) and (pointer: fine)');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const wide = matchMedia('(min-width: 851px)');

  let viewer = null;
  const buildViewer = () => {
    const dialog = document.createElement('dialog');
    dialog.className = 'c-viewer';
    dialog.setAttribute('aria-label', 'Screenshots');
    const icon = (path, size) => `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
    dialog.innerHTML = `
      <div class="c-viewer-top"><span class="c-viewer-count" aria-live="polite"></span><button class="c-viewer-close" type="button" aria-label="Close">${icon('M3 3l10 10M13 3 3 13', 16)}</button></div>
      <div class="c-viewer-track"></div>
      <button class="c-viewer-nav is-prev" type="button" aria-label="Previous screenshot">${icon('M10 3 5 8l5 5', 18)}</button>
      <button class="c-viewer-nav is-next" type="button" aria-label="Next screenshot">${icon('M6 3l5 5-5 5', 18)}</button>
      <p class="c-viewer-hint">← → for the next screenshot · Esc to close</p>`;
    const track = dialog.querySelector('.c-viewer-track');
    const count = dialog.querySelector('.c-viewer-count');
    const prev = dialog.querySelector('.is-prev');
    const next = dialog.querySelector('.is-next');
    links.forEach((link) => {
      const img = link.querySelector('img');
      const feature = link.closest('.c-feature');
      const slide = document.createElement('figure');
      slide.className = 'c-viewer-slide';
      const big = document.createElement('img');
      big.src = link.getAttribute('href');
      big.alt = img.alt;
      big.width = Number(img.getAttribute('width')) || 1360;
      big.height = Number(img.getAttribute('height')) || 960;
      big.loading = 'lazy';
      big.decoding = 'async';
      const caption = document.createElement('figcaption');
      const number = document.createElement('span');
      number.textContent = feature?.querySelector('.eyebrow')?.textContent.trim() || '';
      caption.append(number, feature?.querySelector('h2')?.textContent.trim() || img.alt);
      slide.append(big, caption);
      track.append(slide);
    });
    document.body.append(dialog);

    const current = () => Math.round(track.scrollLeft / track.clientWidth);
    const update = () => {
      const i = current();
      count.textContent = `${i + 1} of ${links.length}`;
      prev.disabled = i === 0;
      next.disabled = i === links.length - 1;
    };
    const show = (i) => {
      const to = Math.max(0, Math.min(links.length - 1, i));
      track.scrollTo({ left: to * track.clientWidth, behavior: still.matches ? 'instant' : 'smooth' });
    };
    track.addEventListener('scroll', update, { passive: true });

    // Back closes the viewer instead of leaving the page: opening adds a history entry, closing removes it.
    let pushed = false;
    dialog.addEventListener('close', () => {
      document.documentElement.classList.remove('c-viewer-open');
      if (pushed) { pushed = false; history.back(); }
    });
    addEventListener('popstate', () => { if (dialog.open) { pushed = false; dialog.close(); } });
    // Narrowed below 851px while open, the viewer would be no bigger than the page, so it closes.
    wide.addEventListener('change', () => { if (!wide.matches && dialog.open) dialog.close(); });
    dialog.querySelector('.c-viewer-close').addEventListener('click', () => dialog.close());
    prev.addEventListener('click', () => show(current() - 1));
    next.addEventListener('click', () => show(current() + 1));
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') { event.preventDefault(); show(current() + 1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); show(current() - 1); }
    });
    track.addEventListener('click', (event) => { if (!event.target.closest('img, figcaption')) dialog.close(); });

    return {
      open: (i) => {
        document.documentElement.classList.add('c-viewer-open');
        dialog.showModal();
        track.scrollLeft = i * track.clientWidth;
        update();
        if (!pushed) { history.pushState({ cViewer: true }, ''); pushed = true; }
      },
    };
  };

  links.forEach((link, i) => {
    const img = link.querySelector('img');
    const aim = (event) => {
      const box = link.getBoundingClientRect();
      link.style.setProperty('--zoom-x', `${(((event.clientX - box.left) / box.width) * 100).toFixed(1)}%`);
      link.style.setProperty('--zoom-y', `${(((event.clientY - box.top) / box.height) * 100).toFixed(1)}%`);
    };
    link.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'mouse' || !mouse.matches || still.matches) return;
      img.sizes = '1360px'; // zoomed in, only the full-size file stays sharp
      link.style.setProperty('--zoom', Math.min(2.5, Math.max(1.8, 1100 / link.clientWidth)).toFixed(2));
      aim(event);
      link.classList.add('is-zoomed');
    });
    link.addEventListener('pointermove', (event) => { if (link.classList.contains('is-zoomed')) aim(event); });
    link.addEventListener('pointerleave', () => link.classList.remove('is-zoomed'));
    link.addEventListener('click', (event) => {
      if (!wide.matches || !('HTMLDialogElement' in window) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      link.classList.remove('is-zoomed');
      (viewer ||= buildViewer()).open(i);
    });
  });
})();
