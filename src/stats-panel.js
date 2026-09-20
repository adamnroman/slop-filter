// Live stats panel, made for demos and recordings. Shows what the extension has done
// on this page since it loaded: posts scanned, slop caught, request time, and cost.
// The core reports each scored post through `globalThis.XAF_STATS.record`.
(() => {
  const CLASS = Object.freeze({
    PANEL: 'xaf-stats',
    HEADER: 'xaf-stats-header',
    DOT: 'xaf-stats-dot',
    RESET: 'xaf-stats-reset',
    GRID: 'xaf-stats-grid',
    VALUE: 'xaf-stats-value',
    LABEL: 'xaf-stats-label',
    FOOT: 'xaf-stats-foot',
  });
  const TEXT = Object.freeze({
    TITLE: 'Slop Filter · live',
    RESET: 'reset',
    SCANNED: 'posts scanned',
    CAUGHT: 'slop caught',
    LAST: 'last request',
    COST: 'total cost',
  });
  const POSTS_PER_BATCH = 1000;
  const COST_DECIMALS = 5;
  const BATCH_COST_DECIMALS = 3;
  const TICK = Object.freeze({ COLOR: 'rgb(168, 151, 255)', MS: 600 });
  const LOCALE = 'en-US';

  const fresh = () => ({
    scanned: 0,
    caught: 0,
    requests: 0,
    questions: 0,
    inputTokens: 0,
    costUsd: 0,
    lastMs: null,
    totalMs: 0,
  });

  let totals = fresh();
  let panel = null;
  const fields = {};

  const count = (n) => n.toLocaleString(LOCALE);
  const ms = (n) => `${count(Math.round(n))} ms`;
  const usd = (n, decimals) => `$${n.toFixed(decimals)}`;

  function readout() {
    const { scanned, caught, requests, questions, inputTokens, costUsd, lastMs, totalMs } = totals;
    const share = scanned ? ` (${Math.round((caught / scanned) * 100)}%)` : '';
    const average = requests ? ms(totalMs / requests) : ms(0);
    const perBatch = requests ? (costUsd / requests) * POSTS_PER_BATCH : 0;
    return {
      scanned: count(scanned),
      caught: `${count(caught)}${share}`,
      last: lastMs === null ? ms(0) : ms(lastMs),
      cost: usd(costUsd, COST_DECIMALS),
      foot: [
        `avg ${average}`,
        `${count(questions)} questions answered`,
        `${count(inputTokens)} tokens`,
        `${usd(perBatch, BATCH_COST_DECIMALS)} per ${count(POSTS_PER_BATCH)} posts`,
      ].join(' · '),
    };
  }

  function render() {
    if (!panel) return;
    for (const [name, text] of Object.entries(readout())) {
      const field = fields[name];
      if (field.textContent === text) continue;
      field.textContent = text;
      // A short color pulse on the numbers that just moved.
      field.animate([{ color: TICK.COLOR }, { color: 'inherit' }], TICK.MS);
    }
  }

  function element(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  function stat(name, label) {
    const cell = element('div', '');
    fields[name] = element('div', CLASS.VALUE);
    cell.append(fields[name], element('div', CLASS.LABEL, label));
    return cell;
  }

  function build() {
    const header = element('div', CLASS.HEADER);
    const reset = element('button', CLASS.RESET, TEXT.RESET);
    reset.type = 'button';
    reset.addEventListener('click', () => {
      totals = fresh();
      render();
    });
    header.append(element('span', CLASS.DOT), element('span', '', TEXT.TITLE), reset);

    const grid = element('div', CLASS.GRID);
    grid.append(
      stat('scanned', TEXT.SCANNED),
      stat('caught', TEXT.CAUGHT),
      stat('last', TEXT.LAST),
      stat('cost', TEXT.COST),
    );
    fields.foot = element('div', CLASS.FOOT);

    const root = element('aside', CLASS.PANEL);
    root.append(header, grid, fields.foot);
    return root;
  }

  // `usage` is null when the answer came from the worker's cache: the post still
  // counts as scanned, but no request was made, so time and cost do not move.
  function record({ usage, isFlagged }) {
    totals.scanned++;
    if (isFlagged) totals.caught++;
    if (usage) {
      totals.requests++;
      totals.questions += usage.questions;
      totals.inputTokens += usage.inputTokens;
      totals.costUsd += usage.costUsd;
      totals.lastMs = usage.latencyMs;
      totals.totalMs += usage.latencyMs;
    }
    render();
  }

  function setEnabled(isEnabled) {
    if (isEnabled && !panel) {
      panel = build();
      document.body.append(panel);
      render();
    } else if (!isEnabled && panel) {
      panel.remove();
      panel = null;
    }
  }

  globalThis.XAF_STATS = Object.freeze({ record, setEnabled });
})();
