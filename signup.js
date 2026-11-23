// Email sign-up forms (the home page's and the 3D Print Monitor page's): each posts its topics and the
// address to the sign-up function on danielyakobian.com, then reports the result in place. Without
// JavaScript the form still posts and the function sends the browser back to a result message.
// A form's topics are its ticked boxes plus any hidden `topic` field. Optional data attributes:
// data-remember (the local storage key, default `signup-done`) and data-done (the success line).
document.querySelectorAll('.signup-form').forEach(signup => {
  const section = signup.closest('.signup');
  const done = section.querySelector('.signup-done');
  const edit = section.querySelector('.signup-edit');
  const status = signup.querySelector('.signup-status');
  const button = signup.querySelector('.signup-button');
  const email = signup.querySelector('.signup-email');
  const boxes = [...signup.querySelectorAll('input[type="checkbox"][name="topic"]')];
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
  // After signing up, the section shrinks to one line. This browser remembers only that it
  // signed up and which topics (never the address), so later visits stay small. Each form has
  // its own key, so signing up on one page doesn't hide the other page's form.
  const KEY = signup.dataset.remember || 'signup-done';
  const remember = topics => {
    try {
      if (topics) localStorage.setItem(KEY, JSON.stringify({ topics }));
      else localStorage.removeItem(KEY);
    } catch {
      // Storage can be blocked; the page still works, it just forgets.
    }
  };
  const message = done.querySelector('.signup-done-message');
  const collapse = (focus = false) => {
    section.classList.add('is-done');
    signup.hidden = true;
    done.hidden = false;
    // Filled in after the row shows, so screen readers announce it.
    message.textContent = '';
    requestAnimationFrame(() => { message.textContent = signup.dataset.done || 'Signup success!'; });
    if (focus) edit.focus();
  };
  edit.addEventListener('click', () => {
    remember(null);
    section.classList.remove('is-done');
    done.hidden = true;
    signup.hidden = false;
    say('');
    email.focus();
  });
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) {
      boxes.forEach(box => { box.checked = saved.topics?.includes(box.value) || false; });
      collapse();
    }
  } catch {
    // Unreadable storage: show the form.
  }
  boxes.forEach(box => box.addEventListener('change', () => {
    if (status.dataset.kind === 'error' && boxes.some(item => item.checked)) say('');
  }));
  signup.addEventListener('submit', async event => {
    event.preventDefault();
    const topics = new FormData(signup).getAll('topic');
    if (!topics.length) {
      say(messages.no_topics, 'error');
      (boxes[0] || email).focus();
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
      say('');
      email.value = '';
      remember(topics);
      collapse(true);
      document.dispatchEvent(new CustomEvent('signup', { detail: { topics } }));
      return;
    }
    say(messages[result.error] || `That didn’t go through. Try again in a minute, or ${contact}.`, 'error');
    document.dispatchEvent(new CustomEvent('signup-error', { detail: { topics, error: result.error || 'unknown' } }));
    if (result.error === 'invalid_email') email.focus();
  });
});
