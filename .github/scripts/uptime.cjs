// Checks that danielyakobian.com and its GitHub Pages copy are up, and keeps one GitHub issue open
// while they aren't. .github/workflows/uptime.yml runs it every 15 minutes.
//
// Locally, `node .github/scripts/uptime.cjs` only prints the results. In GitHub Actions (GITHUB_TOKEN and
// GITHUB_REPOSITORY set) it also opens an issue that mentions the owner when a check fails, keeps that
// issue's status current while checks keep failing, and comments and closes it once every check passes.
// UPTIME_TEST_ALERT=true adds a pretend failure, to test the issue and its email.
const tls = require('node:tls');
const fs = require('node:fs');

const SITE = (process.env.UPTIME_SITE || 'https://danielyakobian.com').replace(/\/$/, '');
const WWW = (process.env.UPTIME_WWW || 'https://www.danielyakobian.com').replace(/\/$/, '');
const MIRROR = (process.env.UPTIME_MIRROR || 'https://danielyaa5.github.io').replace(/\/$/, '');
const TITLE = 'Site check failed';
const OWNER = 'danielyaa5';
const ATTEMPTS = Number(process.env.UPTIME_ATTEMPTS || 3);
const RETRY_WAIT_MS = Number(process.env.UPTIME_RETRY_WAIT_MS || 20000);
const TIMEOUT_MS = 20000;
const CERT_MIN_DAYS = 14;

const CHECKS = [
  { name: 'Home page', url: `${SITE}/`, status: [200], includes: 'Daniel Yakobian' },
  { name: 'Resume', url: `${SITE}/resume/`, status: [200], includes: 'Daniel Yakobian' },
  { name: 'Motorcycle rentals', url: `${SITE}/motorcycle-rentals/`, status: [200], includes: 'Daniel Yakobian' },
  { name: 'Blog', url: `${SITE}/blog/`, status: [200], includes: 'Daniel Yakobian' },
  { name: 'Analytics script', url: `${SITE}/analytics.js`, status: [200], includes: 'posthog' },
  // The sign-up function only takes POST, so a GET answering 405 from the function shows it is deployed and running.
  { name: 'Email sign-up function', url: `${SITE}/api/subscribe/`, status: [405], includes: 'method_not_allowed' },
  { name: 'www redirect', url: `${WWW}/`, status: [301, 302, 307, 308], location: `${SITE}/` },
  { name: 'GitHub Pages copy', url: `${MIRROR}/`, status: [200], includes: 'Daniel Yakobian' },
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchCheck(check) {
  const started = Date.now();
  const response = await fetch(check.url, {
    redirect: 'manual',
    headers: { 'User-Agent': 'danielyakobian.com-uptime-check', 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.text();
  const ms = Date.now() - started;
  if (!check.status.includes(response.status)) return { ok: false, ms, detail: `answered ${response.status}, expected ${check.status.join(' or ')}` };
  if (check.includes && !body.includes(check.includes)) return { ok: false, ms, detail: `page doesn't contain "${check.includes}"` };
  if (check.location && response.headers.get('location') !== check.location) return { ok: false, ms, detail: `redirects to ${response.headers.get('location') || 'nowhere'}, expected ${check.location}` };
  return { ok: true, ms, detail: `${response.status} in ${ms} ms` };
}

function certificateCheck(host) {
  return new Promise(resolve => {
    const started = Date.now();
    const socket = tls.connect({ host, port: 443, servername: host, timeout: TIMEOUT_MS }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      const days = Math.floor((new Date(cert.valid_to) - Date.now()) / 86400000);
      const ms = Date.now() - started;
      if (!socket.authorized) resolve({ ok: false, ms, detail: `certificate isn't trusted (${socket.authorizationError})` });
      else if (days < CERT_MIN_DAYS) resolve({ ok: false, ms, detail: `certificate expires in ${days} days (${cert.valid_to})` });
      else resolve({ ok: true, ms, detail: `valid for ${days} more days` });
    });
    socket.on('timeout', () => { socket.destroy(); resolve({ ok: false, ms: TIMEOUT_MS, detail: 'TLS connection timed out' }); });
    socket.on('error', error => resolve({ ok: false, ms: Date.now() - started, detail: `TLS connection failed (${error.code || error.message})` }));
  });
}

async function run(check) {
  let result;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      result = check.run ? await check.run() : await fetchCheck(check);
    } catch (error) {
      result = { ok: false, ms: null, detail: error.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS / 1000} s` : `request failed (${error.cause?.code || error.message})` };
    }
    if (result.ok) break;
    if (attempt < ATTEMPTS) await sleep(RETRY_WAIT_MS);
  }
  return { name: check.name, url: check.url, ...result };
}

async function github(method, path, body) {
  const api = process.env.GITHUB_API_URL || 'https://api.github.com';
  const response = await fetch(`${api}/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`GitHub ${method} ${path} answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.status === 204 ? null : response.json();
}

function report(results, now, runUrl) {
  const failed = results.filter(r => !r.ok);
  const lines = [
    failed.length
      ? `@${OWNER} ${failed.length === 1 ? 'a check is' : `${failed.length} checks are`} failing on ${SITE.replace(/^https?:\/\//, '')} as of ${now}.`
      : `Every check passes as of ${now}.`,
    '',
    '| Check | Result |',
    '| --- | --- |',
    ...results.map(r => `| ${r.ok ? '✅' : '❌'} [${r.name}](${r.url}) | ${r.detail} |`),
    '',
  ];
  if (runUrl) lines.push(`Latest run: ${runUrl}`, '');
  if (failed.length) lines.push('This issue is updated every 15 minutes while checks fail, and closes itself when they all pass again.');
  return lines.join('\n');
}

(async () => {
  const host = new URL(SITE).hostname;
  const checks = [...CHECKS];
  if (SITE.startsWith('https:')) checks.push({ name: 'TLS certificate', url: `${SITE}/`, run: () => certificateCheck(host) });
  const results = await Promise.all(checks.map(run));
  const testAlert = process.env.UPTIME_TEST_ALERT === 'true';
  if (testAlert) results.push({ name: 'Alert test (not a real outage)', url: `${SITE}/`, ok: false, ms: null, detail: 'pretend failure, started by hand' });

  const failed = results.filter(r => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.detail} (${r.url})`);
  for (const r of failed) console.log(`::warning title=${r.name} failed::${r.detail} (${r.url})`);

  const now = new Date().toISOString().replace(/\.\d+Z$/, ' UTC').replace('T', ' ');
  const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';
  const body = report(results, now, runUrl);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) return;

  const issues = await github('GET', `/issues?state=open&per_page=100&creator=${encodeURIComponent('github-actions[bot]')}`);
  const open = issues.find(issue => !issue.pull_request && issue.title.startsWith(TITLE));
  if (failed.length && !open) {
    const title = testAlert ? `${TITLE} (test, not a real outage)` : `${TITLE}: ${failed.map(r => r.name).join(', ')}`;
    const issue = await github('POST', '/issues', { title, body });
    console.log(`Opened issue #${issue.number}: ${issue.html_url}`);
  } else if (failed.length) {
    await github('PATCH', `/issues/${open.number}`, { body });
    console.log(`Updated issue #${open.number}`);
  } else if (open) {
    await github('POST', `/issues/${open.number}/comments`, { body: `Back up: ${body}` });
    await github('PATCH', `/issues/${open.number}`, { state: 'closed', state_reason: 'completed' });
    console.log(`Closed issue #${open.number}`);
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
