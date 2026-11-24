/* Anonymous page views, page speed (web vitals), browser errors, clicks and rage clicks, project, rental, blog suggestion and TL;DR clicks, resume downloads and email sign-up counts with PostHog,
   without cookies or browser storage. It runs only on the published hosts for non-automated browsers, so local previews, bots and headless checks send nothing,
   and the guest gate page never loads it. */
(() => {
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

  // Uncaught errors and unhandled promise rejections become PostHog `$exception` events for Error tracking.
  // These listeners start with this script, so errors raised before PostHog loads (it waits for the load event)
  // wait in `pendingErrors`. PostHog's own exception autocapture stays off, so nothing is reported twice.
  // Errors from browser extensions, crypto wallets that browsers add to every page (Brave's sets
  // `window.ethereum` and throws on some phones) and cross-origin "Script error." reports (no details) are skipped,
  // and one page sends at most 10, so a loop can't flood the project.
  const pendingErrors = [];
  let errorsSent = 0;
  const sendError = ([error, properties]) => window.posthog?.captureException?.(error, properties);
  const reportError = (error, properties) => {
    if (errorsSent >= 10 || /extension:\/\//.test(`${properties.error_file || ''} ${error?.stack || ''}`)) return;
    if (/\bethereum\b/i.test(`${error?.message || ''} ${error?.stack || ''}`)) return;
    errorsSent += 1;
    if (ready) sendError([error, properties]);
    else pendingErrors.push([error, properties]);
  };
  addEventListener('error', event => {
    if (!event.error && (!event.filename || event.message === 'Script error.')) return;
    reportError(event.error instanceof Error ? event.error : new Error(String(event.message || 'Unknown error')), { error_source: 'uncaught', error_file: event.filename || undefined });
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
  const describe = element => {
    if (!element) return undefined;
    const classes = [...element.classList].slice(0, 3).map(name => `.${name}`).join('');
    return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${classes}`;
  };
  const sendRage = element => {
    ragesSent += 1;
    track('$rageclick', {
      element: describe(element),
      element_parent: describe(element?.parentElement),
      element_text: (element?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) || undefined,
      link: element?.closest('a[href]')?.href,
    });
  };
  document.addEventListener('click', event => {
    if (!event.detail) return; // keyboard activations have no position
    const element = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (element?.closest('pre, code')) return;
    const now = event.timeStamp;
    clickBurst = clickBurst.filter(click => now - click.time < 1000 && Math.hypot(click.x - event.clientX, click.y - event.clientY) < 30);
    clickBurst.push({ time: now, x: event.clientX, y: event.clientY });
    if (heldRage && clickBurst.length > 3) {
      clearTimeout(heldRage.timer);
      sendRage(heldRage.element);
      heldRage = null;
      return;
    }
    if (clickBurst.length !== 3 || ragesSent >= 10) return;
    const selection = getSelection();
    if (event.detail >= 3 && selection && !selection.isCollapsed && element && selection.containsNode(element, true)) {
      const held = { element, timer: setTimeout(() => { if (heldRage === held) heldRage = null; }, 600) };
      heldRage = held;
      return;
    }
    sendRage(element);
  }, true);
  // A promise rejected with something other than an Error has no stack, so the report says what it was: an event's type
  // and element (a script or image that failed to load, say), or an object's class and message or keys. One rejected with
  // nothing at all (undefined or null) can't be traced, so like "Script error." it is skipped.
  const describeReason = reason => {
    if (typeof reason === 'string') return { text: reason };
    if (reason instanceof Event) {
      const target = reason.target instanceof Element ? reason.target : null;
      const url = target?.src || target?.href;
      return { text: `${reason.type} event${target ? ` on ${describe(target)}` : ''}`, file: url ? String(url).split(/[?#]/)[0] : undefined };
    }
    if (typeof reason === 'object') {
      const detail = reason.message ?? reason.reason ?? reason.error;
      const name = reason.constructor?.name || 'Object';
      return { text: detail != null ? `${name}: ${String(detail)}` : `${name} {${Object.keys(reason).slice(0, 6).join(', ')}}` };
    }
    return { text: `${typeof reason} ${String(reason)}` };
  };
  addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    if (reason == null) return;
    if (reason instanceof Error) return reportError(reason, { error_source: 'unhandled_rejection' });
    const { text, file } = describeReason(reason);
    const error = new Error(`Unhandled promise rejection: ${text}`.slice(0, 300));
    reportError(error, { error_source: 'unhandled_rejection', error_file: file });
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
