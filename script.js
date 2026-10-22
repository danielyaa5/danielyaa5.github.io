const about = document.querySelector('#about');
document.querySelector('[data-open-about]').addEventListener('click', () => {
  about.showModal();
});

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
