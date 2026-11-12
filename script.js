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
  const list = document.querySelector('#project-list');
  const title = document.querySelector('#other-projects-title');
  const defaultTitle = title?.textContent || 'Other projects';
  const staticProjects = [...list.querySelectorAll('.project')];
  const featuredMirrors = [...document.querySelectorAll('.featured-pick[data-category]')].map(pick => {
    const art = pick.querySelector('img');
    const nameLink = pick.querySelector('.project-name');
    const description = pick.querySelector('.featured-copy > p');
    const actionLink = pick.querySelector('.featured-link');
    const storeIcon = actionLink?.querySelector('.store-icon');
    const ratio = (Number(art?.getAttribute('width')) / Number(art?.getAttribute('height'))) || 1;
    const artWidth = Math.round(Math.min(134, Math.max(112, 118 * ratio)));

    const article = document.createElement('article');
    article.className = 'project';
    article.dataset.category = pick.dataset.category;
    article.dataset.featuredMirror = 'true';
    article.hidden = true;

    const main = document.createElement('div');
    main.className = 'project-main';
    const artWrap = document.createElement('div');
    artWrap.className = 'project-art';
    const img = document.createElement('img');
    img.className = 'project-illustration';
    img.loading = 'lazy';
    img.src = art.getAttribute('src');
    img.width = Number(art.getAttribute('width'));
    img.height = Number(art.getAttribute('height'));
    img.style.setProperty('--art-width', `${artWidth}px`);
    img.alt = '';
    artWrap.append(img);

    const copy = document.createElement('div');
    copy.className = 'project-copy';
    const h2 = document.createElement('h2');
    const titleAnchor = document.createElement('a');
    titleAnchor.className = 'project-name';
    titleAnchor.href = nameLink.getAttribute('href');
    titleAnchor.textContent = nameLink.textContent.trim();
    h2.append(titleAnchor);
    const benefit = document.createElement('p');
    benefit.className = 'project-benefit';
    benefit.textContent = description.textContent.trim();
    const badge = document.createElement('span');
    badge.className = 'category';
    badge.textContent = 'Featured';
    copy.append(h2, benefit, badge);
    main.append(artWrap, copy);

    const footer = document.createElement('div');
    footer.className = 'project-footer';
    const footerLink = document.createElement('a');
    footerLink.className = 'project-link';
    footerLink.href = actionLink.getAttribute('href');
    const icon = document.createElement('img');
    icon.className = storeIcon ? 'link-icon store-icon' : 'link-icon';
    icon.src = storeIcon ? storeIcon.getAttribute('src') : 'assets/illustrations/link.svg';
    icon.width = storeIcon ? 25 : 14;
    icon.height = storeIcon ? 25 : 14;
    icon.alt = '';
    const label = document.createElement('span');
    label.textContent = actionLink.textContent.trim();
    footerLink.append(icon, label);
    footer.append(footerLink);

    article.append(main, footer);
    return article;
  });

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
    featuredMirrors.forEach(mirror => mirror.remove());
    const matchingFeatured = category === 'all'
      ? []
      : featuredMirrors.filter(mirror => mirror.dataset.category.split(/\s+/).includes(category));
    featuredMirrors.forEach(mirror => {
      mirror.hidden = !matchingFeatured.includes(mirror);
    });
    if (matchingFeatured.length) list.prepend(...matchingFeatured);
    staticProjects.forEach(project => {
      project.hidden = category !== 'all' && !project.dataset.category.split(/\s+/).includes(category);
    });
    if (title) title.textContent = category === 'all' ? defaultTitle : button.textContent;
    const visible = matchingFeatured.length + staticProjects.filter(project => !project.hidden).length;
    count.textContent = `${visible} ${visible === 1 ? 'project' : 'projects'}${category === 'all' ? '' : ` in ${button.textContent}`}`;
  });
}

// Email sign-up: posts the ticked topics and the address to the sign-up function
// on danielyakobian.com, then reports the result in place. Without JavaScript the
// form still posts and the function sends the browser back to a result message.
const signup = document.querySelector('.signup-form');
if (signup) {
  const section = signup.closest('.signup');
  const done = section.querySelector('.signup-done');
  const edit = section.querySelector('.signup-edit');
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
  // After signing up, the section shrinks to one line. This browser remembers only that it
  // signed up and which boxes were ticked (never the address), so later visits stay small.
  const KEY = 'signup-done';
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
    requestAnimationFrame(() => { message.textContent = 'Signup success!'; });
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
}
