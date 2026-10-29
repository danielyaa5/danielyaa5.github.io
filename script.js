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
      project.hidden = category !== 'all' && project.dataset.category !== category;
    });
    const visible = projects.filter(project => !project.hidden).length;
    count.textContent = `${visible} ${visible === 1 ? 'project' : 'projects'}${category === 'all' ? '' : ` in ${button.textContent}`}`;
  });
}
