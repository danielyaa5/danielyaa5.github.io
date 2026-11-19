/* Anonymous page views, page speed (web vitals), browser errors, project, rental, blog suggestion and TL;DR clicks, resume downloads and email sign-up counts with PostHog,
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
  // Errors from browser extensions and cross-origin "Script error." reports (no details) are skipped,
  // and one page sends at most 10, so a loop can't flood the project.
  const pendingErrors = [];
  let errorsSent = 0;
  const sendError = ([error, properties]) => window.posthog?.captureException?.(error, properties);
  const reportError = (error, properties) => {
    if (errorsSent >= 10 || /extension:\/\//.test(`${properties.error_file || ''} ${error?.stack || ''}`)) return;
    errorsSent += 1;
    if (ready) sendError([error, properties]);
    else pendingErrors.push([error, properties]);
  };
  addEventListener('error', event => {
    if (!event.error && (!event.filename || event.message === 'Script error.')) return;
    reportError(event.error instanceof Error ? event.error : new Error(String(event.message || 'Unknown error')), { error_source: 'uncaught', error_file: event.filename || undefined });
  });
  addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    reportError(reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Unhandled promise rejection'), { error_source: 'unhandled_rejection' });
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
      // Link clicks only, so the dashboard shows which projects people open.
      autocapture: { dom_event_allowlist: ['click'], element_allowlist: ['a'] },
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
