/* Anonymous page views with PostHog, without cookies or browser storage.
   It runs only on the published hosts, so local previews and tests send nothing,
   and the guest gate page never loads it. */
(() => {
  const TOKEN = 'phc_phFn2Yijfyw4fMQxXDN878EUWihevmGmEWrUK27bUX4J';
  const HOSTS = ['danielyakobian.com', 'danielyaa5.github.io'];
  if (!HOSTS.includes(location.hostname) || location.pathname.startsWith('/gate')) return;

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
  const scrub = event => {
    for (const bag of [event?.properties, event?.$set, event?.$set_once]) {
      if (bag) for (const key of Object.keys(bag)) bag[key] = clean(bag[key]);
    }
    return event;
  };

  const script = document.createElement('script');
  script.src = 'https://us-assets.i.posthog.com/static/array.js';
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.onload = () => window.posthog?.init(TOKEN, {
    api_host: 'https://us.i.posthog.com',
    defaults: '2026-08-30',
    cookieless_mode: 'always',
    person_profiles: 'never',
    capture_pageview: true,
    capture_pageleave: true,
    // Link clicks only, so the dashboard shows which projects people open.
    autocapture: { dom_event_allowlist: ['click'], element_allowlist: ['a'] },
    rageclick: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_performance: false,
    enable_heatmaps: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_web_experiments: true,
    disable_product_tours: true,
    disable_conversations: true,
    respect_dnt: true,
    before_send: scrub,
  });
  document.head.append(script);
})();
