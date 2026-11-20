// puml-for-markdown page: the hero demo, copy buttons, live counts and the diagram viewer.
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The demo plays muted on a loop, unless the visitor prefers reduced motion. The button pauses and resumes it.
  const video = document.querySelector('[data-demo-video]');
  const toggle = document.querySelector('[data-video-toggle]');
  if (video && toggle) {
    const label = () => {
      toggle.textContent = video.paused ? 'Play' : 'Pause';
      toggle.setAttribute('aria-label', `${video.paused ? 'Play' : 'Pause'} the demo`);
    };
    video.addEventListener('play', label);
    video.addEventListener('pause', label);
    toggle.addEventListener('click', () => (video.paused ? video.play().catch(label) : video.pause()));
    toggle.hidden = false;
    label();
    if (!reduced) {
      video.preload = 'auto';
      video.play().catch(label);
    }
  }

  // Copy buttons for the install line and the two quick-start cards.
  const copyStatus = document.querySelector('[data-copy-status]');
  document.querySelectorAll('[data-copy]').forEach(button => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(document.getElementById(button.dataset.copy).textContent);
        button.textContent = 'Copied';
        copyStatus.textContent = 'Copied to the clipboard.';
        setTimeout(() => { button.textContent = 'Copy'; }, 2000);
      } catch {
        copyStatus.textContent = 'Select the text and copy it manually.';
      }
    });
  });

  // Stars, forks and last week's npm downloads, live. The page keeps the dated counts if either service fails.
  const stats = document.querySelector('[data-stats]');
  if (stats) {
    const get = url => fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(4000) })
      .then(response => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))));
    Promise.all([
      get('https://api.github.com/repos/danielyaa5/puml-for-markdown'),
      get('https://api.npmjs.org/downloads/point/last-week/puml-for-markdown'),
    ]).then(([repo, npm]) => {
      const counts = { stars: repo.stargazers_count, forks: repo.forks_count, downloads: npm.downloads };
      if (!Object.values(counts).every(count => Number.isSafeInteger(count) && count >= 0)) return;
      for (const [key, count] of Object.entries(counts)) stats.querySelector(`[data-stat="${key}"]`).textContent = count.toLocaleString('en-US');
      stats.querySelector('[data-stats-note]').textContent = 'Live from GitHub and npm.';
    }).catch(() => {});
  }

  // The viewer swaps the still image for the SVG itself, so its links work. A link to another diagram opens it
  // in place and adds it to the trail; Back and the trail go back up.
  const viewer = document.querySelector('[data-viewer]');
  if (!viewer) return;
  const folder = '../assets/puml-for-markdown/diagrams/';
  const names = {
    level_1_system_view: 'System view',
    level_2_container_view: 'Container view',
    level_3_component_view_label_retrieval_job: 'Label retrieval job',
    level_3_component_view_pipeline: 'Pipeline component',
    level_4_activity_diagram_export_bq_snapshot_job: 'Export snapshot job',
    level_4_activity_diagram_sampler_a: 'Sampler A activity',
    level_4_activity_diagram_sampler_b: 'Sampler B activity',
  };
  const canvas = viewer.querySelector('[data-viewer-canvas]');
  const trail = viewer.querySelector('[data-viewer-trail]');
  const back = viewer.querySelector('[data-viewer-back]');
  const zoom = viewer.querySelector('[data-viewer-zoom]');
  const open = viewer.querySelector('[data-viewer-open]');
  const hint = viewer.querySelector('[data-viewer-hint]');
  const status = viewer.querySelector('[data-viewer-status]');
  const loaded = new Map();
  let path = [];
  let actualSize = false;
  let current = null;

  const load = name => {
    if (!loaded.has(name)) {
      loaded.set(name, fetch(folder + name + '.svg')
        .then(response => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
        .then(text => {
          const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
          if (svg.nodeName !== 'svg') throw new Error('not an SVG');
          const [, , width, height] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
          svg.dataset.width = width;
          svg.dataset.height = height;
          svg.removeAttribute('style');
          svg.removeAttribute('width');
          svg.removeAttribute('height');
          svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
          svg.setAttribute('role', 'group');
          svg.setAttribute('aria-label', `${names[name]} diagram`);
          return svg;
        })
        .catch(error => { loaded.delete(name); throw error; }));
    }
    return loaded.get(name);
  };

  // Fit the diagram to the box, but never so small that its text can't be read; past that, the box scrolls.
  const fit = () => {
    if (!current) return;
    const width = Number(current.dataset.width), height = Number(current.dataset.height);
    const room = canvas.clientWidth - parseFloat(getComputedStyle(canvas).paddingLeft) * 2;
    const tall = Math.min(innerHeight * 0.72, 700);
    const scale = actualSize ? 1 : Math.min(1, Math.max(0.45, Math.min(room / width, tall / height)));
    current.style.width = `${Math.round(width * scale)}px`;
    current.style.height = `${Math.round(height * scale)}px`;
    hint.hidden = width * scale <= room + 1;
  };

  const show = async (name, depth, announce = true) => {
    let svg;
    try {
      svg = await load(name);
    } catch {
      status.textContent = 'That diagram did not load. Try Open SVG instead.';
      return;
    }
    path = [...path.slice(0, depth), name];
    current = svg;
    canvas.replaceChildren(svg);
    fit();
    canvas.scrollTo(0, 0);
    trail.replaceChildren(...path.map((step, index) => {
      const item = document.createElement('li');
      if (index === path.length - 1) {
        item.textContent = names[step];
        item.setAttribute('aria-current', 'true');
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = names[step];
        button.addEventListener('click', () => show(step, index));
        item.append(button);
      }
      return item;
    }));
    back.disabled = path.length < 2;
    open.href = folder + name + '.svg';
    if (announce) status.textContent = `Showing ${names[name]}.`;
  };

  canvas.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || link.classList.contains('p-fallback')) return;
    const href = link.getAttribute('href') || link.getAttribute('xlink:href') || '';
    const name = href.replace(/\.svg$/, '');
    event.preventDefault();
    if (names[name]) show(name, path.length);
    else if (/^https:\/\//.test(href)) window.open(href, '_blank', 'noopener');
  });
  back.addEventListener('click', () => show(path[path.length - 2], path.length - 2));
  zoom.addEventListener('click', () => {
    actualSize = !actualSize;
    zoom.setAttribute('aria-pressed', String(actualSize));
    fit();
  });
  new ResizeObserver(fit).observe(canvas);

  // Load the first diagram when the viewer comes near the screen.
  const start = () => show('level_1_system_view', 0, false);
  if ('IntersectionObserver' in window) {
    const watcher = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { watcher.disconnect(); start(); }
    }, { rootMargin: '600px 0px' });
    watcher.observe(viewer);
  } else start();
})();
