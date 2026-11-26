/* Anonymous page views, page speed (web vitals), browser errors, clicks and rage clicks, project, rental, blog suggestion and TL;DR clicks, resume downloads and email sign-up counts with PostHog,
   without cookies or browser storage. It runs only on the published hosts for non-automated browsers, so local previews, bots and headless checks send nothing,
   and the guest gate page never loads it. */
(() => {
  const ANALYTICS_VERSION = '19';
  const TOKEN = 'phc_phFn2Yijfyw4fMQxXDN878EUWihevmGmEWrUK27bUX4J';
  const HOSTS = ['danielyakobian.com', 'www.danielyakobian.com', 'danielyaa5.github.io'];
  const BOT_UA = /HeadlessChrome|PhantomJS|Playwright|Puppeteer|SlimerJS|bot|crawler|spider|crawling|Lighthouse|PTST|PageSpeed/i;
  const isAutomated = () =>
    navigator.webdriver === true ||
    BOT_UA.test(navigator.userAgent || '') ||
    Boolean(Array.isArray(navigator.userAgentData?.brands) && navigator.userAgentData.brands.some(b => /HeadlessChrome/i.test(b?.brand || '')));
  if (!HOSTS.includes(location.hostname) || location.pathname.startsWith('/gate') || isAutomated()) return;

  // Addresses on this site keep only their origin and path; queries and fragments stay in the browser.
  const clean = value => {
    if (typeof value !== 'string' || !/^https?:\/\//.test(value)) return value;
    try {
      const url = new URL(value);
      return HOSTS.includes(url.hostname) ? url.origin + url.pathname : value;
    } catch {
      return value;
    }
  };
  // Web vitals, link clicks and error stack frames nest addresses inside objects and lists, so those are cleaned too.
  const cleanAll = (value, depth = 0) => {
    if (value && typeof value === 'object' && depth < 8) {
      for (const key of Object.keys(value)) value[key] = cleanAll(value[key], depth + 1);
      return value;
    }
    return clean(value);
  };
  const scrub = event => {
    if (event) event.properties = { ...event.properties, analytics_version: ANALYTICS_VERSION };
    for (const bag of [event?.properties, event?.$set, event?.$set_once]) {
      if (bag) cleanAll(bag);
    }
    return event;
  };

  // A project_click event for each link opened from a project tile, named after the project,
  // so clicks can be counted per project. Clicks made before PostHog loads wait for it.
  let ready = false;
  const pending = [];
  const send = ([event, properties]) => window.posthog?.capture(event, properties, { transport: 'sendBeacon', send_instantly: true });
  const track = (event, properties) => {
    if (ready) send([event, properties]);
    else pending.push([event, properties]);
  };

  // Keep the original evidence, including errors from another frame. Missing evidence is
  // unknown, not proof that an error came from outside the site.
  const pendingErrors = [];
  let errorsSent = 0;
  const read = (value, key) => { try { return value?.[key]; } catch { return undefined; } };
  const errorURL = value => {
    try {
      const url = new URL(value);
      url.username = ''; url.password = ''; url.search = ''; url.hash = '';
      return url.href;
    } catch { return undefined; }
  };
  const errorText = (value, limit) => typeof value === 'string'
    ? value.slice(0, limit).replace(/(?:https?|[a-z-]*extension):\/\/[^\s<>"')]+/gi, url => {
      const position = url.match(/:\d+(?::\d+)?$/)?.[0] || '';
      return (errorURL(position ? url.slice(0, -position.length) : url) || '[invalid URL]') + position;
    }) : '';
  const ownOrigins = new Set([location.origin, 'https://us-assets.i.posthog.com', ...HOSTS.map(host => `https://${host}`)]);
  const frameLines = error => error.stack.split('\n').filter(line =>
    !line.startsWith(`${error.name}:`) && /^\s*at\s+.+|^[^@\s]*@\S+/.test(line));
  const sourceOf = (error, file) => {
    const sources = file ? [file] : [];
    // Only frame lines are source evidence. A URL in an error message is not a frame.
    for (const line of frameLines(error)) {
      for (const url of line.match(/https?:\/\/[^\s)]+/g) || []) sources.push(url.replace(/:\d+(?::\d+)?$/, ''));
    }
    const origins = sources.map(value => { try { return new URL(value).origin; } catch { return null; } });
    if (origins.some(origin => ownOrigins.has(origin))) return 'site';
    if (origins.length && origins.every(origin => origin && origin !== 'null')) return 'external';
    return 'unknown';
  };
  const normalizeError = (reason, fallback, file) => {
    const message = read(reason, 'message');
    const originalStack = read(reason, 'stack');
    const originalName = read(reason, 'name');
    const errorLike = typeof message === 'string' && (typeof originalStack === 'string' || typeof originalName === 'string');
    const error = new Error(errorText(errorLike ? message : fallback, 300) || 'Unknown error');
    error.name = errorText(errorLike ? originalName : 'Error', 80) || 'Error';
    // Never leave the stack constructed above: that points at this collector, not the failure.
    error.stack = errorText(originalStack, 8000).split('\n').slice(0, 31).join('\n');
    const source = errorURL(file || read(reason, 'sourceURL') || read(reason, 'fileName'));
    const stackAvailable = frameLines(error).length > 0;
    return { error, file: source, stackAvailable };
  };
  const sendError = ([error, properties]) => {
    if (properties.error_stack_available) window.posthog?.captureException?.(error, properties);
    else {
      // captureException synthesizes a caller stack for a stackless error. The documented
      // manual exception format leaves it absent, so grouping uses the original type/message.
      track('$exception', { ...properties, $exception_list: [{ type: error.name, value: error.message,
        mechanism: { type: properties.error_source, handled: false, synthetic: false } }] });
    }
  };
  const reportError = (reason, fallback, properties) => {
    const normalized = normalizeError(reason, fallback, properties.error_file);
    const { error, file, stackAvailable } = normalized;
    if (errorsSent >= 10 || /extension:\/\//.test(`${file || ''} ${frameLines(error).join('\n')}`)) return;
    if (/\bethereum\b/i.test(`${error.message} ${error.stack}`)) return;
    const origin = sourceOf(error, file);
    const details = { ...properties, error_file: file, error_origin: origin,
      error_from_site: origin === 'unknown' ? null : origin === 'site', error_stack_available: stackAvailable };
    errorsSent += 1;
    if (ready) sendError([error, details]);
    else pendingErrors.push([error, details]);
  };
  addEventListener('error', event => {
    if (!event.error && (!event.filename || event.message === 'Script error.')) return;
    reportError(event.error, String(event.message || 'Unknown error'), {
      error_source: 'uncaught', error_file: event.filename || undefined,
    });
  });
  // Rage clicks: 3 or more clicks within 1 s inside a 30 px circle, on any element. PostHog's own rage click detection only
  // counts links, buttons and other clickable-looking elements, which misses the case that matters most here: something that
  // looks clickable but isn't. It sends PostHog's standard $rageclick event, one per burst and at most 10 per page.
  // Clicks on code samples don't count: a triple click there is how people select a line to copy. Elsewhere, a triple
  // click that ends with the clicked text selected (copying a heading, say) is held for a moment and dropped unless the
  // clicking goes on, since people clicking in frustration rarely stop at exactly three.
  let clickBurst = [];
  let ragesSent = 0;
  let heldRage = null;
  let burstSent = false;
  let burstClicks = 0;
  let lastPointer = 'unknown';
  const describe = element => {
    if (!element) return undefined;
    const classes = [...element.classList].slice(0, 3).map(name => `.${name}`).join('');
    return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${classes}`;
  };
  const sendRage = (element, details) => {
    if (burstSent || ragesSent >= 10) return;
    burstSent = true;
    ragesSent += 1;
    track('$rageclick', {
      ...details,
      element: describe(element),
      element_parent: describe(element?.parentElement),
      element_text: (element?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) || undefined,
      link: element?.closest('a[href]')?.href,
    });
  };
  document.addEventListener('pointerdown', event => {
    lastPointer = ['mouse', 'touch', 'pen'].includes(event.pointerType) ? event.pointerType : 'unknown';
  }, true);
  document.addEventListener('click', event => {
    if (!event.detail) return; // keyboard activations have no position
    const element = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (element?.closest('pre, code')) return;
    const now = event.timeStamp;
    clickBurst = clickBurst.filter(click => now - click.time < 1000 && Math.hypot(click.x - event.clientX, click.y - event.clientY) < 30);
    if (!clickBurst.length) {
      burstSent = false;
      burstClicks = 0;
      if (heldRage) clearTimeout(heldRage.timer);
      heldRage = null;
    }
    clickBurst.push({ time: now, x: event.clientX, y: event.clientY });
    burstClicks = Math.min(burstClicks + 1, 100);
    const selection = getSelection();
    const details = { click_count: burstClicks, click_detail: Math.min(event.detail, 100),
      pointer_type: lastPointer, text_selected: Boolean(selection && !selection.isCollapsed),
      target_interactive: Boolean(element?.closest('a, button, input, select, textarea, summary, [role="button"], [role="slider"]')),
      viewport_width: Math.min(innerWidth, 10000) };
    if (heldRage) {
      clearTimeout(heldRage.timer);
      sendRage(heldRage.element, details);
      heldRage = null;
      return;
    }
    if (clickBurst.length !== 3 || ragesSent >= 10 || burstSent) return;
    if (event.detail >= 3 && selection && !selection.isCollapsed && element && selection.containsNode(element, true)) {
      const held = { element, timer: setTimeout(() => { if (heldRage === held) heldRage = null; }, 600) };
      heldRage = held;
      return;
    }
    sendRage(element, details);
  }, true);
  // Describe non-Error rejections without invoking arbitrary getters or throwing in the reporter.
  const describeReason = reason => {
    if (typeof reason === 'string') return { text: reason };
    const target = read(reason, 'target');
    const type = read(reason, 'type');
    if (typeof type === 'string' && read(target, 'nodeType') === 1) {
      const file = read(target, 'src') || read(target, 'href');
      const tag = read(target, 'tagName');
      return { text: `${type} event on ${typeof tag === 'string' ? tag.toLowerCase() : 'element'}`, file };
    }
    if (typeof reason === 'object') {
      const detail = read(reason, 'message') ?? read(reason, 'reason') ?? read(reason, 'error');
      const constructorName = read(read(reason, 'constructor'), 'name');
      const name = typeof constructorName === 'string' ? constructorName.slice(0, 80) : 'Object';
      if (['string', 'number', 'boolean'].includes(typeof detail)) return { text: `${name}: ${detail}` };
      try { return { text: `${name} {${Object.keys(reason).slice(0, 6).join(', ')}}` }; }
      catch { return { text: 'Uninspectable object' }; }
    }
    return { text: typeof reason === 'function' ? 'function' : `${typeof reason} ${String(reason)}` };
  };
  addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    if (reason == null) return;
    const { text, file } = describeReason(reason);
    reportError(reason, `Unhandled promise rejection: ${text}`, { error_source: 'unhandled_rejection', error_file: file });
  });
  const tileClick = event => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = event.target.closest?.('a[href]');
    const tile = link?.closest('.featured-pick, #project-list .project');
    if (!tile) return;
    const featured = tile.matches('.featured-pick');
    const filter = document.querySelector('.project-filters [aria-pressed="true"]')?.dataset.filter;
    // The title link stretches over the whole tile, so a pointer click outside the name's own box
    // counts as `tile`. Keyboard clicks (detail 0) count as `title`.
    const onName = !event.detail || [...link.getClientRects()].some(box =>
      event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom);
    const properties = {
      project: (tile.querySelector('.project-name, h2, h3')?.textContent || '').trim(),
      link: link.matches('.project-name') ? (onName ? 'title' : 'tile') : link.matches('.star-count') ? 'stars' : 'button',
      link_text: link.textContent.replace(/\s+/g, ' ').trim(),
      destination: link.href,
      section: featured ? 'featured' : 'other',
      position: [...document.querySelectorAll(featured ? '.featured-pick' : '#project-list .project')].indexOf(tile) + 1,
      ...(featured || !filter ? {} : { filter }),
    };
    track('project_click', properties);
  };
  document.addEventListener('click', tileClick);
  document.addEventListener('auxclick', tileClick);

  // A rental_click event for each Riders Share or Twisted Road link on the motorcycle rentals page,
  // named after the bike and the site. The profile links at the top count as "All bikes".
  const rentalClick = event => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = event.target.closest?.('.rentals a[data-platform]');
    if (!link) return;
    const bike = link.closest('.bike');
    track('rental_click', {
      bike: bike ? (bike.querySelector('h3')?.textContent || '').trim() : 'All bikes',
      platform: link.dataset.platform,
      link_text: link.textContent.replace(/\s+/g, ' ').trim(),
      destination: link.href,
      position: bike ? [...document.querySelectorAll('.bike')].indexOf(bike) + 1 : 0,
    });
  };
  document.addEventListener('click', rentalClick);
  document.addEventListener('auxclick', rentalClick);

  // A resume_download event for each click on a link to the resume PDF, named after the button:
  // `top` (under the name), `scroll_bar` (the bar that slides in on scroll), `end` (the last section) or `other`.
  const RESUME_PDF = /\/assets\/[^/]*resume[^/]*\.pdf$/i;
  const resumeClick = event => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = event.target.closest?.('a[href]');
    if (!link || !RESUME_PDF.test(link.pathname)) return;
    const button = link.matches('.scroll-download') ? 'scroll_bar' : link.matches('.r-hero .download') ? 'top' : link.closest('.end-cta') ? 'end' : 'other';
    track('resume_download', { button, link_text: link.textContent.replace(/\s+/g, ' ').trim(), destination: link.href });
  };
  document.addEventListener('click', resumeClick);
  document.addEventListener('auxclick', resumeClick);

  // An app_download_click event for each download button on an app page (links with data-store), naming the app
  // (the page's folder), the store (`app_store`, `direct` for the free Mac download, or `polar` for its license key) and where the button sits: `hero` (top),
  // `end` (the closing box) or `whats_new` (a version's release rows on What's new). These links carry `ph-no-capture`, so PostHog's autocapture doesn't
  // count the click again.
  const downloadClick = event => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = event.target.closest?.('a[href][data-store]');
    if (!link) return;
    track('app_download_click', {
      app: location.pathname.split('/')[1] || 'home',
      store: link.dataset.store,
      placement: link.closest('.c-hero-copy') ? 'hero' : link.closest('.c-cta') ? 'end' : link.closest('.w-where') ? 'whats_new' : 'other',
      link_text: link.textContent.replace(/\s+/g, ' ').replace(/\s*↗$/, '').trim(),
      destination: link.href,
    });
  };
  document.addEventListener('click', downloadClick);
  document.addEventListener('auxclick', downloadClick);

  // A suggested_blog_click event when a reader clicks a recommended post card at the end of an article.
  const suggestedBlogClick = event => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = event.target.closest?.('a[href]');
    const card = link?.closest('.article-related .related-card');
    if (!card) return;
    track('suggested_blog_click', {
      source: location.pathname,
      destination: link.href,
      title: (card.querySelector('h3')?.textContent || '').trim(),
      position: [...document.querySelectorAll('.article-related .related-card')].indexOf(card) + 1,
    });
  };
  document.addEventListener('click', suggestedBlogClick);
  document.addEventListener('auxclick', suggestedBlogClick);

  // A tldr_link_click event for clicks on jump links and references inside an article's TL;DR summary box.
  const tldrClick = event => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = event.target.closest?.('a[href]');
    if (!link?.closest('.article-tldr')) return;
    track('tldr_link_click', {
      source: location.pathname,
      destination: link.href,
      label: (link.textContent || '').trim(),
      is_anchor: (link.getAttribute('href') || '').startsWith('#'),
    });
  };
  document.addEventListener('click', tldrClick);
  document.addEventListener('auxclick', tldrClick);

  // Email sign-ups from the home page form, with the topics ticked. The address itself is never sent.
  const topicProperties = topics => ({
    topics,
    topic_count: topics.length,
    new_apps: topics.includes('new_apps'),
    beta: topics.includes('beta'),
    promos: topics.includes('promos'),
  });
  document.addEventListener('signup', event => track('email_signup', topicProperties(event.detail?.topics || [])));
  document.addEventListener('signup-error', event => track('email_signup_failed', { ...topicProperties(event.detail?.topics || []), error: String(event.detail?.error || 'unknown') }));

  // On danielyakobian.com, PostHog goes through this site's own /dy-relay/ path (rewrites in vercel.json), which ad blockers
  // don't block. The GitHub Pages copy has no rewrites, so it talks to PostHog directly.
  const relay = location.hostname.endsWith('danielyakobian.com') ? `${location.origin}/dy-relay` : null;
  const script = document.createElement('script');
  script.src = `${relay || 'https://us-assets.i.posthog.com'}/static/array.js`;
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.onload = () => {
    window.posthog?.init(TOKEN, {
      api_host: relay || 'https://us.i.posthog.com',
      ui_host: 'https://us.posthog.com',
      defaults: '2026-08-30',
      cookieless_mode: 'always',
      person_profiles: 'never',
      capture_pageview: true,
      capture_pageleave: true,
      // Clicks on any interactive element (links, buttons, filters, form fields), not only links.
      // Clicks only: no form changes or submits, and PostHog never records what is typed into fields.
      autocapture: { dom_event_allowlist: ['click'] },
      // Rage clicks come from the detector near the top of this file instead, which also covers non-interactive elements.
      rageclick: false,
      capture_dead_clicks: false,
      // Errors are reported by the listeners near the top of this file instead, so early errors aren't lost.
      capture_exceptions: false,
      // Page speed (LCP, INP, CLS, FCP) for PostHog's Web vitals dashboard; no network timing.
      capture_performance: { web_vitals: true, network_timing: false },
      enable_heatmaps: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_web_experiments: true,
      disable_product_tours: true,
      disable_conversations: true,
      respect_dnt: true,
      before_send: scrub,
    });
    ready = true;
    pending.splice(0).forEach(send);
    pendingErrors.splice(0).forEach(sendError);
  };
  // PostHog's own script starts loading only after the page's load event, and then when the browser is idle
  // (at the latest 2 s later), so it never competes with the images and styles the visitor is waiting for.
  // Clicks and sign-ups in the meantime wait in `pending` above and are sent once it is ready.
  const start = () => document.head.append(script);
  const whenIdle = () => ('requestIdleCallback' in window ? requestIdleCallback(start, { timeout: 2000 }) : setTimeout(start, 2000));
  if (document.readyState === 'complete') whenIdle();
  else addEventListener('load', whenIdle, { once: true });
})();
