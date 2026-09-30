(() => {
  const { MSG, STORE, LABEL, DEFAULTS, PROVIDER } = globalThis.XAF;

  const EXPORT_FILENAME = 'labels.json';
  const BLOCKED_FILENAME = 'blocked.json';
  const MANIFEST_PATH = 'manifest.json';
  // Typing in the key field saves after this pause, so closing the tab right after a
  // paste still keeps the key.
  const TYPING_PAUSE_MS = 500;
  const SAVED_NOTE_MS = 2000;
  const TEXT = Object.freeze({
    SAVED: 'Saved.',
    BAD_WEIGHTS: 'Weights must be JSON shaped like {"bias": number, "w": {...}}.',
    CONFIRM_CLEAR: 'Delete every saved label?',
    UNBLOCK: 'Unblock',
    NO_BLOCKED: 'No blocked accounts. Hover a score and click Block, or accept the offer after a few flagged posts.',
    BLOCKED_COUNT: (n) => `${n} blocked. Their posts are hidden on sight and never sent to Jev.`,
    BAD_BLOCKED: 'blocked.json must be an object of {"site:handle": {"site", "handle"}} entries.',
    ACCOUNT_CHECKING: 'Checking\u2026',
    ACCOUNT_NONE: 'Not paired. Sign in, then enter a pairing code.',
    PAIRING: 'Pairing\u2026',
    PAUSED: 'Scoring is paused.',
    RESUMED: 'Resumed. The next post will ask again.',
    SIGN_IN_LINK: 'Sign in',
    ACCOUNT_LINK: 'Account',
    NOTICE_SENT: 'Sent. If nothing appeared, check macOS System Settings, Notifications, Google Chrome.',
    NO_CODE: 'Enter the pairing code first.',
    ACCOUNT_TRIAL: ({ email, trial_posts, trial_limit }) =>
      trial_posts >= trial_limit
        ? `Signed in as ${email}. Trial used up, and the $3.99 charge didn't go through. Check your card on the account page.`
        : `Signed in as ${email}. Trial: ${trial_posts} of ${trial_limit} posts used.`,
    ACCOUNT_ACTIVE: ({ email, posts_month, complimentary }) =>
      complimentary
        ? `Signed in as ${email}. Free account. ${posts_month} posts this month.`
        : `Signed in as ${email}. Subscribed. ${posts_month} posts this month.`,
    ACCOUNT_STATE: ({ email, state }) => `Signed in as ${email}. ${ACCOUNT_STATE_TEXT[state] ?? state}`,
  });
  // How each server-side account state reads on the page.
  const ACCOUNT_STATE_TEXT = Object.freeze({
    pending: 'No card yet. Start the free trial on the account page.',
    trial_over: "Trial over, and the $3.99 charge didn't go through. Check your card on the account page.",
    past_due: 'Payment failed. Update your card to keep scoring.',
    canceled: 'Subscription canceled.',
  });
  const ACCOUNT_STATE = Object.freeze({ TRIAL: 'trial', ACTIVE: 'active' });

  // Styled in options.css via [data-state].
  const STATUS_STATE = Object.freeze({ OK: 'ok', ERROR: 'error' });

  const $ = (id) => document.getElementById(id);

  // Every simple setting: which element, which storage key, how to read it, and the
  // event that means "the user is done changing it".
  const FIELDS = Object.freeze([
    { id: 'apiKey', key: STORE.API_KEY, event: 'input', pauseMs: TYPING_PAUSE_MS, read: (el) => el.value.trim() },
    { id: 'openrouterKey', key: STORE.OPENROUTER_KEY, event: 'input', pauseMs: TYPING_PAUSE_MS, read: (el) => el.value.trim() },
    { id: 'threshold', key: STORE.THRESHOLD, event: 'change', read: (el) => Number(el.value) / 100 },
    { id: 'mode', key: STORE.MODE, event: 'change', read: (el) => el.value },
    { id: 'labeling', key: STORE.LABELING, event: 'change', read: (el) => el.checked },
    { id: 'stats', key: STORE.STATS, event: 'change', read: (el) => el.checked },
    { id: 'youtubeVideos', key: STORE.YOUTUBE_VIDEOS, event: 'change', read: (el) => el.checked },
  ]);

  let clearNote;
  function status(text, isError = false) {
    clearTimeout(clearNote);
    $('status').textContent = text;
    $('status').dataset.state = isError ? STATUS_STATE.ERROR : STATUS_STATE.OK;
    // Errors stay until fixed. "Saved." fades out by itself.
    if (!isError) clearNote = setTimeout(() => ($('status').textContent = ''), SAVED_NOTE_MS);
  }

  // The weights field sits in a collapsed <details>. Open it so the error has something to point at.
  function revealWeights() {
    $('advanced').open = true;
    $('weights').focus();
  }

  function parseWeights(raw) {
    if (!raw.trim()) return null;
    const weights = JSON.parse(raw);
    if (typeof weights.bias !== 'number' || typeof weights.w !== 'object') throw new Error();
    return weights;
  }

  // A pause is the one problem worth showing before anything else on this page.
  function showPause(pause) {
    const isPaused = Boolean(pause) && Date.now() < pause.until;
    $('resume').hidden = !isPaused;
    if (!isPaused) {
      if ($('status').dataset.state === STATUS_STATE.ERROR && $('status').textContent.startsWith(TEXT.PAUSED)) status('');
      return;
    }
    // The server's reset time when there is one; the retry time otherwise.
    const resumes = ` Resumes ${new Date(pause.resetsAt ?? pause.until).toLocaleString()}.`;
    status(`${TEXT.PAUSED} ${pause.message}${resumes}`, true);
  }

  // A pause can begin or end while this page is open.
  chrome.storage.onChanged.addListener((changes) => {
    if (changes[STORE.PAUSE]) showPause(changes[STORE.PAUSE].newValue ?? null);
  });

  // Ends the pause by hand. The next post asks again; if it is refused, it pauses afresh.
  async function resumeNow() {
    await chrome.storage.local.remove(STORE.PAUSE);
    $('resume').hidden = true;
    status(TEXT.RESUMED);
  }

  async function load() {
    const stored = await chrome.storage.local.get(Object.values(STORE));
    showPause(stored[STORE.PAUSE]);
    $('apiKey').value = stored[STORE.API_KEY] ?? '';
    $('openrouterKey').value = stored[STORE.OPENROUTER_KEY] ?? '';
    hasToken = Boolean(stored[STORE.SESSION_TOKEN]);
    showProvider(stored[STORE.PROVIDER] ?? DEFAULTS.provider);
    // The server is only asked about the account when the paid plan is the one in use.
    if (checked('plan') === PLAN.PAID) showAccount(hasToken);
    else showPairing(hasToken);
    $('threshold').value = Math.round((stored[STORE.THRESHOLD] ?? DEFAULTS.threshold) * 100);
    $('thresholdValue').textContent = $('threshold').value;
    $('mode').value = stored[STORE.MODE] ?? DEFAULTS.mode;
    $('labeling').checked = stored[STORE.LABELING] ?? DEFAULTS.labeling;
    $('stats').checked = stored[STORE.STATS] ?? DEFAULTS.stats;
    $('youtubeVideos').checked = stored[STORE.YOUTUBE_VIDEOS] ?? DEFAULTS.youtubeVideos;
    $('weights').value = stored[STORE.WEIGHTS] ? JSON.stringify(stored[STORE.WEIGHTS], null, 2) : '';
    showLabelCounts(stored[STORE.LABELS] ?? {});
    showBlocked(stored[STORE.BLOCKED] ?? {});
  }

  // The page asks two questions, "your key or mine" and, for your key, "from where".
  // Together they are the one stored provider.
  const PLAN = Object.freeze({ OWN: 'own', PAID: 'paid' });
  const OWN_KEY = Object.freeze({
    [PROVIDER.TYPESAFE]: {
      label: 'TypeSafe API key',
      input: 'apiKey',
      hint: 'Stays in your browser. Post text goes to TypeSafe for scoring and nowhere else.',
      getKey: 'https://console.typesafe.ai/keys',
    },
    [PROVIDER.OPENROUTER]: {
      label: 'OpenRouter API key',
      input: 'openrouterKey',
      hint: 'Same AI, same answers. Post text goes to OpenRouter, which forwards it to TypeSafe and bills your credits.',
      getKey: 'https://openrouter.ai/settings/keys',
    },
  });
  const checked = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
  const check = (name, value) => {
    const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  };

  function providerFromChoice() {
    if (checked('plan') === PLAN.PAID) return PROVIDER.SLOPFILTER;
    return Object.hasOwn(OWN_KEY, checked('keyKind')) ? checked('keyKind') : DEFAULTS.provider;
  }

  // Sets the radios and the visible fields from a stored provider.
  function showProvider(provider) {
    const isPaid = provider === PROVIDER.SLOPFILTER;
    check('plan', isPaid ? PLAN.PAID : PLAN.OWN);
    // On the paid plan the own-key toggle still needs a position: the key they have.
    const keyKind = Object.hasOwn(OWN_KEY, provider)
      ? provider
      : $('openrouterKey').value && !$('apiKey').value ? PROVIDER.OPENROUTER : PROVIDER.TYPESAFE;
    check('keyKind', keyKind);
    showKeyFields();
  }

  function showKeyFields() {
    const isPaid = checked('plan') === PLAN.PAID;
    $('ownKeyField').hidden = isPaid;
    $('slopfilterField').hidden = !isPaid;
    const kind = OWN_KEY[checked('keyKind')] ?? OWN_KEY[DEFAULTS.provider];
    for (const { input } of Object.values(OWN_KEY)) $(input).hidden = input !== kind.input;
    $('keyLabel').textContent = kind.label;
    $('keyLabel').htmlFor = kind.input;
    $('keyHint').replaceChildren(
      `${kind.hint} `,
      Object.assign(document.createElement('a'), { href: kind.getKey, target: '_blank', rel: 'noopener noreferrer', textContent: 'Get a key' }),
      '.',
    );
  }

  let hasToken = false;

  async function saveProvider() {
    showKeyFields();
    const provider = providerFromChoice();
    await chrome.storage.local.set({ [STORE.PROVIDER]: provider });
    status(TEXT.SAVED);
    if (provider === PROVIDER.SLOPFILTER) showAccount(hasToken);
  }

  function send(message) {
    return chrome.runtime.sendMessage(message).then((response) => {
      if (response?.ok) return response.result;
      throw new Error(response?.error ?? 'No response from background worker');
    });
  }

  function accountLine(account) {
    if (account.state === ACCOUNT_STATE.TRIAL) return TEXT.ACCOUNT_TRIAL(account);
    if (account.state === ACCOUNT_STATE.ACTIVE) return TEXT.ACCOUNT_ACTIVE(account);
    return TEXT.ACCOUNT_STATE(account);
  }

  // Paired: the account line and Sign out. Not paired: the code field and Pair.
  function showPairing(isPaired) {
    $('pairRow').hidden = isPaired;
    $('pairedRow').hidden = !isPaired;
    $('signIn').textContent = isPaired ? TEXT.ACCOUNT_LINK : TEXT.SIGN_IN_LINK;
  }

  // Asks the background worker, which holds the token, what the server says about the account.
  async function showAccount(isPaired) {
    const line = $('account');
    showPairing(isPaired);
    if (!isPaired) {
      line.textContent = TEXT.ACCOUNT_NONE;
      return;
    }
    line.textContent = TEXT.ACCOUNT_CHECKING;
    try {
      line.textContent = accountLine(await send({ type: MSG.ACCOUNT }));
    } catch (error) {
      line.textContent = error.message;
    }
  }

  async function pairWithCode() {
    const code = $('pairCode').value.trim();
    if (!code) {
      status(TEXT.NO_CODE, true);
      return;
    }
    $('account').textContent = TEXT.PAIRING;
    try {
      const account = await send({ type: MSG.PAIR, code });
      hasToken = true;
      $('pairCode').value = '';
      $('account').textContent = accountLine(account);
      showPairing(true);
      status(TEXT.SAVED);
    } catch (error) {
      status(error.message, true);
      $('account').textContent = TEXT.ACCOUNT_NONE;
    }
  }

  async function signOut() {
    await chrome.storage.local.remove(STORE.SESSION_TOKEN);
    hasToken = false;
    showAccount(false);
    status(TEXT.SAVED);
  }

  function showLabelCounts(labels) {
    const rows = Object.values(labels);
    const ai = rows.filter((row) => row.label === LABEL.AI).length;
    $('labelCounts').textContent = `${rows.length} labeled: ${ai} AI, ${rows.length - ai} human.`;
  }

  // Settings save by themselves, one field at a time, the moment they change.
  // `then` runs after the save, for fields whose value is worth checking against a server.
  function saveOnChange({ id, key, event, pauseMs = 0, read, then }) {
    let pending;
    $(id).addEventListener(event, () => {
      clearTimeout(pending);
      pending = setTimeout(async () => {
        await chrome.storage.local.set({ [key]: read($(id)) });
        status(TEXT.SAVED);
        then?.();
      }, pauseMs);
    });
  }

  // Weights save when the field loses focus. Bad JSON is reported and nothing is saved.
  async function saveWeights() {
    let weights;
    try {
      weights = parseWeights($('weights').value);
    } catch {
      status(TEXT.BAD_WEIGHTS, true);
      revealWeights();
      return;
    }
    if (weights) await chrome.storage.local.set({ [STORE.WEIGHTS]: weights });
    else await chrome.storage.local.remove(STORE.WEIGHTS);
    status(TEXT.SAVED);
  }

  // This page is read from disk every time it opens. The running extension is not.
  // A version mismatch means Chrome still has old page scripts in memory.
  async function warnIfStale() {
    const running = chrome.runtime.getManifest().version;
    $('version').textContent = `v${running}`;
    const onDisk = await fetch(chrome.runtime.getURL(MANIFEST_PATH), { cache: 'no-store' })
      .then((response) => response.json())
      .then((manifest) => manifest.version)
      .catch(() => running);
    if (onDisk === running) return;
    $('runningVersion').textContent = running;
    $('diskVersion').textContent = onDisk;
    $('stale').hidden = false;
  }

  function showBlocked(blocked) {
    const list = $('blockedList');
    list.replaceChildren();
    const entries = Object.entries(blocked).sort((a, b) => (b[1].blocked_at ?? 0) - (a[1].blocked_at ?? 0));
    $('blockedCount').textContent = entries.length ? TEXT.BLOCKED_COUNT(entries.length) : TEXT.NO_BLOCKED;
    for (const [key, { site, handle }] of entries) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = `${site}: ${handle}`;
      const unblock = document.createElement('button');
      unblock.type = 'button';
      unblock.className = 'button';
      unblock.textContent = TEXT.UNBLOCK;
      unblock.addEventListener('click', async () => {
        const { [STORE.BLOCKED]: current = {} } = await chrome.storage.local.get(STORE.BLOCKED);
        delete current[key];
        await chrome.storage.local.set({ [STORE.BLOCKED]: current });
        showBlocked(current);
      });
      item.append(name, unblock);
      list.append(item);
    }
  }

  function download(filename, data) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: filename });
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportBlocked() {
    const { [STORE.BLOCKED]: blocked = {} } = await chrome.storage.local.get(STORE.BLOCKED);
    download(BLOCKED_FILENAME, blocked);
  }

  // Merges the file into the list. Entries already there are kept.
  async function importBlocked(event) {
    const file = event.target.files[0];
    if (!file) return;
    let imported;
    try {
      imported = JSON.parse(await file.text());
      const valid = imported && typeof imported === 'object' && !Array.isArray(imported)
        && Object.values(imported).every((entry) => typeof entry?.site === 'string' && typeof entry?.handle === 'string');
      if (!valid) throw new Error();
    } catch {
      status(TEXT.BAD_BLOCKED, true);
      return;
    }
    const { [STORE.BLOCKED]: current = {} } = await chrome.storage.local.get(STORE.BLOCKED);
    const merged = { ...imported, ...current };
    await chrome.storage.local.set({ [STORE.BLOCKED]: merged });
    showBlocked(merged);
    status(TEXT.SAVED);
    event.target.value = '';
  }

  async function exportLabels() {
    const { [STORE.LABELS]: labels = {} } = await chrome.storage.local.get(STORE.LABELS);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(labels, null, 2)], { type: 'application/json' }),
    );
    const link = Object.assign(document.createElement('a'), { href: url, download: EXPORT_FILENAME });
    link.click();
    URL.revokeObjectURL(url);
  }

  async function clearLabels() {
    if (!confirm(TEXT.CONFIRM_CLEAR)) return;
    await chrome.storage.local.remove(STORE.LABELS);
    showLabelCounts({});
  }

  $('threshold').addEventListener('input', () => {
    $('thresholdValue').textContent = $('threshold').value;
  });
  FIELDS.forEach(saveOnChange);
  for (const input of document.querySelectorAll('input[name="plan"], input[name="keyKind"]')) {
    input.addEventListener('change', saveProvider);
  }
  $('pair').addEventListener('click', pairWithCode);
  $('pairCode').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') pairWithCode();
  });
  $('signOut').addEventListener('click', signOut);
  $('resume').addEventListener('click', resumeNow);
  $('weights').addEventListener('change', saveWeights);
  $('exportLabels').addEventListener('click', exportLabels);
  $('exportBlocked').addEventListener('click', exportBlocked);
  $('importBlocked').addEventListener('change', importBlocked);
  $('clearLabels').addEventListener('click', clearLabels);
  $('reloadExtension').addEventListener('click', () => chrome.runtime.reload());
  $('testNotice').addEventListener('click', async () => {
    try {
      await send({ type: MSG.TEST_NOTICE });
      status(TEXT.NOTICE_SENT);
    } catch (error) {
      status(error.message, true);
    }
  });
  load();
  warnIfStale();
})();
