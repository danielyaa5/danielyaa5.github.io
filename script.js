document.querySelectorAll('[data-github-stars]').forEach(async badge => {
  try {
    const response = await fetch(`https://api.github.com/repos/${badge.dataset.githubStars}`, {
      credentials: 'omit',
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) return;
    const { stargazers_count: count } = await response.json();
    if (!Number.isSafeInteger(count) || count < 0) return;
    badge.querySelector('[data-star-number]').textContent = count.toLocaleString('en-US');
    badge.setAttribute('aria-label', `${count.toLocaleString('en-US')} GitHub stars`);
    badge.title = 'GitHub stars';
  } catch {
    // Keep the verified count if GitHub is unavailable or rate-limited.
  }
});


const filters = document.querySelector('.project-filters');
if (filters) {
  const projects = [...document.querySelectorAll('#project-list .project')];
  const count = document.querySelector('.filter-count');
  filters.hidden = false;
  count.hidden = false;
  filters.addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    const category = button.dataset.filter;
    filters.querySelectorAll('button').forEach(item => {
      item.setAttribute('aria-pressed', String(item === button));
    });
    projects.forEach(project => {
      project.hidden = category !== 'all' && !project.dataset.category.split(/\s+/).includes(category);
    });
    const visible = projects.filter(project => !project.hidden).length;
    count.textContent = `${visible} ${visible === 1 ? 'project' : 'projects'}${category === 'all' ? '' : ` in ${button.textContent}`}`;
  });
}

// Email sign-up: posts the ticked topics and the address to the sign-up function
// on danielyakobian.com, then reports the result in place. Without JavaScript the
// form still posts and the function sends the browser back to a result message.
const signup = document.querySelector('.signup-form');
if (signup) {
  const status = signup.querySelector('.signup-status');
  const button = signup.querySelector('.signup-button');
  const email = signup.querySelector('.signup-email');
  const boxes = [...signup.querySelectorAll('input[name="topic"]')];
  const say = (html, kind = '') => {
    status.innerHTML = html;
    status.dataset.kind = kind;
  };
  const contact = 'write to <a href="mailto:support@danielyakobian.com">support@danielyakobian.com</a>';
  const messages = {
    invalid_email: 'That email address doesn’t look right. Check it and try again.',
    no_topics: 'Pick at least one kind of email.',
    not_configured: `Sign-ups aren’t open yet. To get on the list now, ${contact}.`,
  };
  boxes.forEach(box => box.addEventListener('change', () => {
    if (status.dataset.kind === 'error' && boxes.some(item => item.checked)) say('');
  }));
  signup.addEventListener('submit', async event => {
    event.preventDefault();
    const topics = boxes.filter(box => box.checked).map(box => box.value);
    if (!topics.length) {
      say(messages.no_topics, 'error');
      boxes[0].focus();
      return;
    }
    button.disabled = true;
    say('Signing you up…');
    let result = {};
    try {
      // A form-encoded body keeps this a simple cross-origin request from danielyaa5.github.io.
      const response = await fetch(signup.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new URLSearchParams(new FormData(signup)),
        credentials: 'omit',
        signal: AbortSignal.timeout(20000),
      });
      result = await response.json().catch(() => ({}));
      if (!response.ok && !result.error) result.error = `http_${response.status}`;
    } catch {
      result = { error: 'network' };
    }
    button.disabled = false;
    if (result.ok) {
      say('You’re signed up. Thanks!', 'success');
      email.value = '';
      document.dispatchEvent(new CustomEvent('signup', { detail: { topics } }));
      return;
    }
    say(messages[result.error] || `That didn’t go through. Try again in a minute, or ${contact}.`, 'error');
    document.dispatchEvent(new CustomEvent('signup-error', { detail: { topics, error: result.error || 'unknown' } }));
    if (result.error === 'invalid_email') email.focus();
  });
}
