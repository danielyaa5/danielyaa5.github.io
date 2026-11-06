// Scroll effects for the web resume. The page reads fine without them: every section,
// number and role is in the HTML, and this script only adds motion and the scroll bar.
(() => {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bar = document.querySelector('.scroll-bar');
  const where = bar.querySelector('.scroll-where');
  const sectionLabel = bar.querySelector('.scroll-section');
  const detailLabel = bar.querySelector('.scroll-detail');
  const heroDownload = document.querySelector('.r-hero .download');
  const sections = [...document.querySelectorAll('[data-section]')];
  const roles = [...document.querySelectorAll('#experience .role')];
  const index = document.querySelector('.exp-index');
  const indexLinks = [...index.querySelectorAll('a')];
  const now = document.querySelector('.now');

  // Swap text with a short fade, or at once when motion is reduced.
  const swap = (el, update) => {
    if (reduceMotion) return update();
    el.classList.add('is-swapping');
    clearTimeout(el.swapTimer);
    el.swapTimer = setTimeout(() => { update(); el.classList.remove('is-swapping'); }, 150);
  };

  // Show the bar once the big button has scrolled off the top of the screen.
  new IntersectionObserver(([entry]) => {
    const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
    bar.classList.toggle('is-shown', show);
    bar.inert = !show;
  }).observe(heroDownload);

  // Count the impact numbers up (or down, for 15→2) the first time they appear.
  const count = el => {
    const to = Number(el.dataset.count);
    const from = Number(el.dataset.from || 0);
    const format = n => el.dataset.format.replace('#', Math.round(n));
    if (reduceMotion) return;
    const start = performance.now();
    const duration = 1100;
    const step = time => {
      const t = Math.min(1, (time - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = format(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step);
    };
    el.textContent = format(from);
    requestAnimationFrame(step);
  };

  // Reveal each block once as it reaches the screen.
  const revealer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      entry.target.querySelectorAll('[data-count]').forEach(count);
      revealer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach(el => revealer.observe(el));

  // Track the section and role under the reading line, a third of the way down the screen.
  let activeSection = null;
  let activeRole = null;
  const setRole = role => {
    if (role === activeRole) return;
    activeRole = role;
    const i = roles.indexOf(role);
    roles.forEach((r, n) => r.classList.toggle('is-active', n === i));
    indexLinks.forEach((a, n) => {
      a.classList.toggle('is-active', n === i);
      a.classList.toggle('is-past', n < i);
      if (n === i) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
    swap(now, () => {
      now.querySelector('.now-when').textContent = role.dataset.years;
      now.querySelector('.now-org').textContent = role.dataset.org;
      now.querySelector('.now-title').textContent = role.querySelector('h3').textContent;
      const stack = now.querySelector('.now-stack');
      stack.replaceChildren(...role.dataset.stack.split(/,\s*/).map(name => Object.assign(document.createElement('li'), { textContent: name })));
    });
  };
  const setWhere = (section, detail) => {
    const key = `${section}|${detail}`;
    if (key === activeSection) return;
    const first = activeSection === null;
    activeSection = key;
    const update = () => { sectionLabel.textContent = section; detailLabel.textContent = detail; };
    if (first) update(); else swap(where, update);
  };

  let queued = false;
  const onScroll = () => {
    queued = false;
    const doc = document.documentElement;
    bar.style.setProperty('--read', Math.min(1, scrollY / Math.max(1, doc.scrollHeight - innerHeight)).toFixed(4));
    // The reading line sits a third of the way down, then slides lower over the last 300px
    // of scrolling so the final sections, which can't reach it, still become current.
    const maxScroll = doc.scrollHeight - innerHeight;
    const tail = Math.max(0, Math.min(1, (scrollY - (maxScroll - 300)) / 300));
    const line = innerHeight * (0.33 + 0.6 * tail);
    const section = sections.filter(s => s.getBoundingClientRect().top <= line).pop() || sections[0];
    const role = roles.filter(r => r.getBoundingClientRect().top <= line).pop() || roles[0];
    setRole(role);
    setWhere(section.dataset.section, section.id === 'experience' ? role.dataset.org : '');
    const first = roles[0].getBoundingClientRect();
    const last = roles[roles.length - 1].getBoundingClientRect();
    const progress = (line - first.top) / Math.max(1, last.top - first.top);
    index.style.setProperty('--progress', Math.max(0, Math.min(1, progress)).toFixed(4));
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(onScroll); } };
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue);
  onScroll();
})();
