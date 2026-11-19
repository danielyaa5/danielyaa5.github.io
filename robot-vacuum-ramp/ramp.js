// Robot vacuum ramp guide: the size finder and the copy button for the Etsy message.
// Both start hidden, so the page reads the same without JavaScript.
(() => {
  const MM_PER_INCH = 25.4;
  // The ramp is designed around a 16 degree climb from a 0.6 mm leading edge (from the Etsy listing).
  const CLIMB = Math.tan(16 * Math.PI / 180);
  const LEADING_EDGE_MM = 0.6;

  // The size finder reads its ranges and prices from the table, so the two can't disagree.
  const finder = document.getElementById('size-finder');
  const table = document.getElementById('size-table');
  if (finder && table) {
    const heights = [...table.querySelectorAll('tbody tr')].map(row => ({
      max: Number(row.dataset.max),
      label: row.querySelector('th').dataset.label,
      prices: [...row.querySelectorAll('td')].map(cell => cell.textContent.trim())
    }));
    const widths = [...table.querySelectorAll('thead th[data-max]')].map(cell => ({ max: Number(cell.dataset.max), label: cell.dataset.label }));
    const output = finder.querySelector('output');
    const unitLabels = finder.querySelectorAll('[data-unit-label]');
    // Compare in the unit the visitor typed, with each limit converted to it, so 22.86 mm sits exactly on 0.9 in.
    const limit = (inches, unit) => unit === 'mm' ? Math.round(inches * MM_PER_INCH * 100) / 100 : inches;
    const pick = (value, ranges, unit) => ranges.findIndex(range => value <= limit(range.max, unit) + 1e-9);
    const show = (text, kind, note) => {
      output.replaceChildren();
      const main = document.createElement(kind === 'match' ? 'strong' : 'span');
      main.textContent = text;
      output.append(main);
      if (note) {
        const extra = document.createElement('span');
        extra.className = 'finder-reach';
        extra.textContent = note;
        output.append(' ', extra);
      }
      output.dataset.kind = kind;
    };
    // Rough horizontal reach into the room for the height typed, shown in the visitor's unit first.
    const reach = (height, unit) => {
      const heightMm = unit === 'mm' ? height : height * MM_PER_INCH;
      const mm = Math.max(0, heightMm - LEADING_EDGE_MM) / CLIMB;
      const inches = `${(mm / MM_PER_INCH).toFixed(1)} in`;
      const millimeters = `${Math.round(mm)} mm`;
      return unit === 'mm' ? `${millimeters} (${inches})` : `${inches} (${millimeters})`;
    };

    const update = () => {
      const unit = finder.elements.unit.value;
      unitLabels.forEach(label => { label.textContent = unit; });
      const height = parseFloat(finder.elements.height.value);
      const width = parseFloat(finder.elements.width.value);
      if (!(height > 0) || !(width > 0)) return show('Enter your threshold height and doorway width to see the matching option.', '');
      const h = pick(height, heights, unit);
      const w = pick(width, widths, unit);
      const tallest = heights[heights.length - 1].max;
      const widest = widths[widths.length - 1].max;
      const outside = [];
      if (h < 0) outside.push(`taller than the listed sizes, which stop at ${tallest} in (${limit(tallest, 'mm')} mm)`);
      if (w < 0) outside.push(`wider than the listed sizes, which stop at ${widest} in (${limit(widest, 'mm')} mm)`);
      if (outside.length) return show(`That's ${outside.join(', and ')}.`, 'outside', "Send me your measurements anyway, and I'll let you know if I can make one.");
      show(`${heights[h].label}, ${widths[w].label}: ${heights[h].prices[w]} for one side.`, 'match', `It would reach roughly ${reach(height, unit)} into the room.`);
    };

    finder.addEventListener('input', update);
    finder.addEventListener('change', update);
    finder.addEventListener('submit', event => { event.preventDefault(); update(); });
    finder.hidden = false;
    update();
  }

  for (const button of document.querySelectorAll('[data-copy]')) {
    const source = document.querySelector(button.dataset.copy);
    const status = button.parentElement.querySelector('.copy-status');
    if (!source || !navigator.clipboard?.writeText) continue;
    button.hidden = false;
    let timer;
    button.addEventListener('click', async () => {
      clearTimeout(timer);
      try {
        await navigator.clipboard.writeText(source.textContent.trim());
        if (status) status.textContent = 'Copied. Paste it into your Etsy message.';
      } catch {
        if (status) status.textContent = 'Copy didn\'t work here. Select the text above instead.';
      }
      timer = setTimeout(() => { if (status) status.textContent = ''; }, 6000);
    });
  }
})();
