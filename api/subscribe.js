// Email sign-up for the home page form, run as a Vercel function at /api/subscribe/.
// Each sign-up becomes a Resend contact opted in to the topics the visitor ticked.
// RESEND_API_KEY (a full-access key) is a Vercel environment variable; nothing
// secret lives in this repository. GitHub Pages serves this file as plain text
// and never runs it, so the form on danielyaa5.github.io posts here too.

const RESEND = 'https://api.resend.com';
const SITE = 'https://danielyakobian.com';
const ORIGINS = new Set([SITE, 'https://danielyaa5.github.io']);

// The form's checkbox values and the Resend topic each one maps to. Topics are
// found by name and created on first use, opted out by default, so contacts
// get only what they ticked and can change it from any email's unsubscribe page.
// `formerly` lists earlier names; a topic found under one is renamed in place so
// its subscribers stay on it.
const TOPICS = {
  new_apps: { name: 'New app and open source launches', description: 'An email when Daniel releases a new app or open source project.', formerly: ['New app launches'] },
  beta: { name: 'Beta tester invites', description: 'Try apps early and get them free for life!' },
  promos: { name: 'Promos', description: 'Discounts and promo codes for paid apps.' },
};

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
let topicIds = null;

class ResendError extends Error {
  constructor(status, body) {
    super(`Resend answered ${status}: ${JSON.stringify(body).slice(0, 300)}`);
    this.status = status;
  }
}

async function resend(method, path, body, attempt = 0) {
  const response = await fetch(RESEND + path, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'danielyakobian.com-signup',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  // Resend allows a few requests a second per account; wait and retry when it says so.
  if (response.status === 429 && attempt < 3) {
    const wait = Math.min(Number(response.headers.get('retry-after')) || 1, 3);
    await new Promise(resolve => setTimeout(resolve, wait * 1000));
    return resend(method, path, body, attempt + 1);
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new ResendError(response.status, data);
  return data;
}

async function loadTopicIds() {
  if (topicIds) return topicIds;
  const existing = [];
  let after = '';
  for (let page = 0; page < 10; page++) {
    const list = await resend('GET', `/topics?limit=100${after && `&after=${encodeURIComponent(after)}`}`);
    existing.push(...(list?.data || []));
    if (!list?.has_more || !list.data?.length) break;
    after = list.data[list.data.length - 1].id;
  }
  const ids = {};
  for (const [key, topic] of Object.entries(TOPICS)) {
    const oldest = names => existing.filter(item => names.includes(item.name)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
    const found = oldest([topic.name]);
    if (found) {
      ids[key] = found.id;
      continue;
    }
    const renamed = oldest(topic.formerly || []);
    if (renamed) {
      ids[key] = renamed.id;
      try {
        await resend('PATCH', `/topics/${encodeURIComponent(renamed.id)}`, { name: topic.name, description: topic.description });
      } catch (error) {
        // A failed rename leaves the old name showing in Resend; sign-ups still land on the right topic.
        console.error('topic rename failed', error.message);
      }
      continue;
    }
    const fields = { name: topic.name, description: topic.description, default_subscription: 'opt_out' };
    let created;
    try {
      created = await resend('POST', '/topics', { ...fields, visibility: 'public' });
    } catch (error) {
      // Accounts whose API predates topic visibility reject the field; private topics still work.
      if (!(error instanceof ResendError) || error.status >= 500) throw error;
      created = await resend('POST', '/topics', fields);
    }
    ids[key] = created.id;
  }
  topicIds = ids;
  return ids;
}

async function subscribe(email, topics) {
  const ids = await loadTopicIds();
  const subscriptions = topics.map(topic => ({ id: ids[topic], subscription: 'opt_in' }));
  const address = encodeURIComponent(email);
  let exists = true;
  try {
    await resend('GET', `/contacts/${address}`);
  } catch (error) {
    if (!(error instanceof ResendError) || error.status !== 404) throw error;
    exists = false;
  }
  if (!exists) {
    await resend('POST', '/contacts', { email, unsubscribed: false, topics: subscriptions });
    return 'created';
  }
  // Signing up again adds the newly ticked topics and turns email back on;
  // topics left unticked keep whatever the contact chose before.
  await resend('PATCH', `/contacts/${address}`, { unsubscribed: false });
  await resend('PATCH', `/contacts/${address}/topics`, subscriptions);
  return 'updated';
}

function readBody(req) {
  const body = req.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : '';
  if (/^\s*\{/.test(text)) {
    try { return JSON.parse(text); } catch { return {}; }
  }
  const params = new URLSearchParams(text);
  const result = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    result[key] = values.length > 1 ? values : values[0];
  }
  return result;
}

// Without JavaScript the browser posts the form directly; send it back to the
// page, where the matching message is shown with :target.
function finish(req, res, status, result) {
  const wantsJson = /application\/json/.test(req.headers.accept || '');
  if (wantsJson) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(result));
    return;
  }
  const origin = ORIGINS.has(req.headers.origin) ? req.headers.origin : SITE;
  res.statusCode = 303;
  res.setHeader('Location', `${origin}/#${status < 300 ? 'signup-thanks' : 'signup-failed'}`);
  res.end();
}

async function handler(req, res) {
  const origin = req.headers.origin;
  if (ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    finish(req, res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  const body = readBody(req);
  // A field people never see; bots that fill it are told they signed up.
  if (typeof body.company === 'string' && body.company.trim()) {
    finish(req, res, 200, { ok: true });
    return;
  }
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const topics = [...new Set([].concat(body.topic ?? body.topics ?? []))].filter(topic => typeof topic === 'string' && Object.hasOwn(TOPICS, topic));
  if (!email || email.length > 254 || !EMAIL.test(email)) {
    finish(req, res, 400, { ok: false, error: 'invalid_email' });
    return;
  }
  if (!topics.length) {
    finish(req, res, 400, { ok: false, error: 'no_topics' });
    return;
  }
  if (!process.env.RESEND_API_KEY) {
    finish(req, res, 503, { ok: false, error: 'not_configured' });
    return;
  }
  try {
    await subscribe(email, topics);
    finish(req, res, 200, { ok: true });
  } catch (error) {
    console.error('signup failed', error.message);
    topicIds = null;
    if (error instanceof ResendError && error.status === 422 && /email/i.test(error.message)) {
      finish(req, res, 400, { ok: false, error: 'invalid_email' });
      return;
    }
    finish(req, res, 502, { ok: false, error: 'provider_error' });
  }
}

module.exports = handler;
module.exports.TOPICS = TOPICS;
module.exports.resetCache = () => { topicIds = null; };
