const assert = require('node:assert/strict');
const path = require('node:path');

// Runs the sign-up function (api/subscribe.js) against a fake Resend API, so no
// request leaves the machine. Run: node tests/subscribe-api.cjs
const handler = require(path.join(__dirname, '..', 'api', 'subscribe.js'));

function fakeResend({ topics = [], contacts = new Map(), failCreate = null, rateLimitOnce = false } = {}) {
  const calls = [];
  let limited = !rateLimitOnce;
  let nextId = 1;
  global.fetch = async (url, options = {}) => {
    const { pathname, searchParams } = new URL(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ method, pathname, body, auth: options.headers?.Authorization });
    const reply = (status, data, headers = {}) => new Response(data === undefined ? '' : JSON.stringify(data), { status, headers });
    if (!limited) {
      limited = true;
      return reply(429, { name: 'rate_limit_exceeded' }, { 'retry-after': '0' });
    }
    if (method === 'GET' && pathname === '/topics') {
      assert.equal(searchParams.get('limit'), '100');
      return reply(200, { object: 'list', has_more: false, data: topics });
    }
    const topicPath = pathname.match(/^\/topics\/([^/]+)$/);
    if (method === 'PATCH' && topicPath) {
      const topic = topics.find(t => t.id === decodeURIComponent(topicPath[1]));
      if (!topic) return reply(404, { name: 'not_found' });
      Object.assign(topic, body);
      return reply(200, { object: 'topic', id: topic.id });
    }
    if (method === 'POST' && pathname === '/topics') {
      if (failCreate === 'visibility' && 'visibility' in body) return reply(422, { name: 'validation_error', message: 'Unknown field visibility' });
      const topic = { id: `topic-${nextId++}`, created_at: new Date().toISOString(), ...body };
      topics.push(topic);
      return reply(201, { object: 'topic', id: topic.id });
    }
    const contact = pathname.match(/^\/contacts\/([^/]+)(\/topics)?$/);
    if (contact) {
      const email = decodeURIComponent(contact[1]);
      if (!contacts.has(email)) return reply(404, { name: 'not_found' });
      if (method === 'GET') return reply(200, { object: 'contact', email, ...contacts.get(email) });
      if (method === 'PATCH' && contact[2]) {
        const saved = contacts.get(email);
        for (const item of body) saved.topics[item.id] = item.subscription;
        return reply(200, { object: 'contact_topics', id: email });
      }
      if (method === 'PATCH') {
        Object.assign(contacts.get(email), body);
        return reply(200, { object: 'contact', id: email });
      }
    }
    if (method === 'POST' && pathname === '/contacts') {
      if (failCreate === 'contact') return reply(500, { name: 'internal_server_error' });
      contacts.set(body.email, { unsubscribed: body.unsubscribed, topics: Object.fromEntries(body.topics.map(t => [t.id, t.subscription])) });
      return reply(201, { object: 'contact', id: body.email });
    }
    return reply(404, { name: 'not_found', message: `${method} ${pathname}` });
  };
  return { calls, topics, contacts };
}

async function call({ method = 'POST', body, headers = {} } = {}) {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(chunk = '') { this.body += chunk; this.ended = true; },
  };
  const req = { method, body, headers: { accept: 'application/json', ...headers } };
  await handler(req, res);
  assert.ok(res.ended, 'response finished');
  let json = null;
  try { json = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, headers: res.headers, json };
}

(async () => {
  process.env.RESEND_API_KEY = 're_test_key';

  // First sign-up: the three topics are created opted out by default and public, then the contact is created opted in to what was ticked.
  handler.resetCache();
  let resend = fakeResend();
  let result = await call({ body: 'email=reader%40example.com&topic=new_apps&topic=promos&company=', headers: { origin: 'https://danielyaa5.github.io' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.json, { ok: true });
  assert.equal(result.headers['access-control-allow-origin'], 'https://danielyaa5.github.io', 'GitHub Pages copy may post here');
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.deepEqual(resend.topics.map(t => [t.name, t.default_subscription, t.visibility]), [
    ['New app and open source launches', 'opt_out', 'public'],
    ['Beta tester invites', 'opt_out', 'public'],
    ['Promos', 'opt_out', 'public'],
  ]);
  assert.ok(resend.topics.every(t => t.name.length <= 50 && t.description.length <= 200), 'topic names and descriptions fit Resend limits');
  const ids = Object.fromEntries(resend.topics.map(t => [t.name, t.id]));
  assert.deepEqual(resend.contacts.get('reader@example.com'), { unsubscribed: false, topics: { [ids['New app and open source launches']]: 'opt_in', [ids.Promos]: 'opt_in' } });
  assert.ok(resend.calls.every(c => c.auth === 'Bearer re_test_key'), 'every request uses the key');

  // Signing up again on a warm function reuses the topic IDs, re-enables email and adds the new topic.
  resend.contacts.get('reader@example.com').unsubscribed = true;
  const before = resend.calls.length;
  resend = { ...resend, ...fakeResend({ topics: resend.topics, contacts: resend.contacts }) };
  result = await call({ body: { email: ' reader@example.com ', topic: 'beta' } });
  assert.equal(result.status, 200);
  assert.ok(!resend.calls.some(c => c.pathname === '/topics'), 'topic IDs are cached between sign-ups');
  assert.deepEqual(resend.contacts.get('reader@example.com'), { unsubscribed: false, topics: { [ids['New app and open source launches']]: 'opt_in', [ids.Promos]: 'opt_in', [ids['Beta tester invites']]: 'opt_in' } });
  assert.ok(before > 0);

  // A cold function finds existing topics by name instead of creating more.
  handler.resetCache();
  resend = fakeResend({ topics: resend.topics, contacts: resend.contacts });
  result = await call({ body: 'email=second%40example.com&topic=beta' });
  assert.equal(result.status, 200);
  assert.equal(resend.topics.length, 3, 'no duplicate topics');
  assert.ok(!resend.calls.some(c => c.method === 'POST' && c.pathname === '/topics'));
  assert.deepEqual(resend.contacts.get('second@example.com').topics, { [ids['Beta tester invites']]: 'opt_in' });

  // A topic created under an earlier name is renamed in place, keeping its subscribers.
  handler.resetCache();
  const legacy = [
    { id: 'old-new-apps', name: 'New app launches', description: 'An email when Daniel releases a new app.', default_subscription: 'opt_out', created_at: '2026-11-07T18:09:00Z' },
    { id: 'old-beta', name: 'Beta tester invites', description: 'x', default_subscription: 'opt_out', created_at: '2026-11-07T18:09:00Z' },
    { id: 'old-promos', name: 'Promos', description: 'x', default_subscription: 'opt_out', created_at: '2026-11-07T18:09:00Z' },
  ];
  resend = fakeResend({ topics: legacy, contacts: new Map([['owner@example.com', { unsubscribed: false, topics: { 'old-new-apps': 'opt_in' } }]]) });
  result = await call({ body: 'email=fifth%40example.com&topic=new_apps' });
  assert.equal(result.status, 200);
  assert.equal(resend.topics.length, 3, 'no new topic is created for a rename');
  assert.equal(resend.topics[0].name, 'New app and open source launches');
  assert.equal(resend.topics[0].description, 'An email when Daniel releases a new app or open source project.');
  assert.deepEqual(resend.contacts.get('fifth@example.com').topics, { 'old-new-apps': 'opt_in' }, 'new sign-ups join the renamed topic');
  assert.deepEqual(resend.calls.filter(c => c.method === 'PATCH' && c.pathname.startsWith('/topics/')).map(c => c.pathname), ['/topics/old-new-apps']);

  // Rate limits are retried; accounts that reject topic visibility still get topics.
  handler.resetCache();
  resend = fakeResend({ rateLimitOnce: true, failCreate: 'visibility' });
  result = await call({ body: 'email=third%40example.com&topic=promos' });
  assert.equal(result.status, 200);
  assert.equal(resend.calls[0].pathname, '/topics');
  assert.equal(resend.calls[1].pathname, '/topics', 'retried after 429');
  assert.equal(resend.topics.length, 3);

  // Bad input never reaches Resend.
  for (const [body, error] of [
    ['email=not-an-email&topic=beta', 'invalid_email'],
    ['email=&topic=beta', 'invalid_email'],
    ['email=a%40example.com', 'no_topics'],
    ['email=a%40example.com&topic=everything', 'no_topics'],
  ]) {
    resend = fakeResend();
    result = await call({ body });
    assert.equal(result.status, 400, body);
    assert.equal(result.json.error, error, body);
    assert.equal(resend.calls.length, 0, `${body} sends nothing to Resend`);
  }

  // The hidden field catches bots without telling them.
  resend = fakeResend();
  result = await call({ body: 'email=bot%40example.com&topic=beta&company=Spam+Inc' });
  assert.deepEqual([result.status, result.json], [200, { ok: true }]);
  assert.equal(resend.calls.length, 0);

  // Provider failures are reported without details.
  handler.resetCache();
  resend = fakeResend({ failCreate: 'contact' });
  result = await call({ body: 'email=fourth%40example.com&topic=beta' });
  assert.deepEqual([result.status, result.json], [502, { ok: false, error: 'provider_error' }]);

  // CORS preflight, other origins and other methods.
  result = await call({ method: 'OPTIONS', headers: { origin: 'https://danielyakobian.com' } });
  assert.equal(result.status, 204);
  assert.equal(result.headers['access-control-allow-origin'], 'https://danielyakobian.com');
  result = await call({ method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.equal(result.headers['access-control-allow-origin'], undefined, 'other sites get no CORS access');
  result = await call({ method: 'GET' });
  assert.deepEqual([result.status, result.json.error], [405, 'method_not_allowed']);

  // Without JavaScript the browser is sent back to the page's result message.
  resend = fakeResend({ topics: resend.topics });
  handler.resetCache();
  result = await call({ body: 'email=nojs%40example.com&topic=new_apps', headers: { accept: 'text/html', origin: 'https://danielyaa5.github.io' } });
  assert.deepEqual([result.status, result.headers.location], [303, 'https://danielyaa5.github.io/#signup-thanks']);
  result = await call({ body: 'email=nojs%40example.com', headers: { accept: 'text/html' } });
  assert.deepEqual([result.status, result.headers.location], [303, 'https://danielyakobian.com/#signup-failed']);

  // Without the key the form says sign-ups aren't open, and nothing is sent.
  delete process.env.RESEND_API_KEY;
  resend = fakeResend();
  result = await call({ body: 'email=a%40example.com&topic=beta' });
  assert.deepEqual([result.status, result.json.error, resend.calls.length], [503, 'not_configured', 0]);

  console.log('Sign-up API checks passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
