// The before/after slider: drag anywhere on the picture, or focus the handle and use the arrow keys.
// On the product page its two images load only when it nears the screen, so they don't compete with the first image;
// the full-width page (compare/) gives them real src attributes instead.
// Shared by cloud-media-shrinker/ and cloud-media-shrinker/compare/.
// On touch, a tap or a sideways drag moves it and an up-and-down swipe still scrolls the page.
(() => {
  const box = document.querySelector('.cmp');
  if (!box) return;
  const handle = box.querySelector('.cmp-handle');
  let pos = 50, dragging = null, moved = false, startX = 0, startY = 0;
  const load = () => box.querySelectorAll('img[data-src]').forEach((img) => {
    img.sizes = img.dataset.sizes || img.getAttribute('sizes'); img.srcset = img.dataset.srcset; img.src = img.dataset.src;
    delete img.dataset.src; delete img.dataset.srcset;
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries, observer) => {
      if (entries.some((entry) => entry.isIntersecting)) { load(); observer.disconnect(); }
    }, { rootMargin: '600px 0px' }).observe(box);
  } else load();
  const set = (value) => {
    pos = Math.min(100, Math.max(0, value));
    box.style.setProperty('--pos', pos + '%');
    box.dataset.edge = pos < 18 ? 'start' : pos > 82 ? 'end' : '';
    const shown = Math.round(pos);
    handle.setAttribute('aria-valuenow', shown);
    handle.setAttribute('aria-valuetext', shown + '% original, ' + (100 - shown) + '% Keep 4K');
  };
  const fromEvent = (event) => {
    const rect = box.getBoundingClientRect();
    set(((event.clientX - rect.left) / rect.width) * 100);
  };
  box.addEventListener('pointerdown', (event) => {
    if (event.button > 0 || event.target.closest('a')) return;
    dragging = event.pointerId; moved = false; startX = event.clientX; startY = event.clientY;
    if (event.pointerType !== 'touch') { fromEvent(event); box.setPointerCapture(event.pointerId); event.preventDefault(); handle.focus({ preventScroll: true }); }
  });
  box.addEventListener('pointermove', (event) => {
    if (event.pointerId !== dragging) return;
    if (!moved && event.pointerType === 'touch') {
      // A finger moves the slider only once it's clearly going sideways; up and down is left to scrolling.
      const dx = Math.abs(event.clientX - startX), dy = Math.abs(event.clientY - startY);
      if (dx < 6 && dy < 6) return;
      if (dy >= dx) { dragging = null; return; }
      box.setPointerCapture(event.pointerId);
    }
    moved = true; fromEvent(event);
  });
  const end = (event) => {
    if (event.pointerId !== dragging) return;
    if (event.type === 'pointerup' && event.pointerType === 'touch' && !moved) fromEvent(event);
    dragging = null;
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 10 : 2;
    const next = { ArrowLeft: pos - step, ArrowDown: pos - step, ArrowRight: pos + step, ArrowUp: pos + step, PageDown: pos - 10, PageUp: pos + 10, Home: 0, End: 100 }[event.key];
    if (next === undefined) return;
    event.preventDefault(); set(next);
  });
})();
