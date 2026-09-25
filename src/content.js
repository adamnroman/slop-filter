// Site-neutral core. Finds posts on the page through the site adapter, asks the
// background worker to score them, and hides the ones over the threshold. Also
// collects AI/human labels for fitting weights.
(() => {
  const { MSG, STORE, MODE, LABEL, DEFAULTS, BLOCK_AFTER_FLAGS } = globalThis.XAF;
  // Everything site-specific lives in the adapter loaded before this file (src/sites/).
  const SITE = globalThis.XAF_SITE;
  // The optional live stats panel (src/stats-panel.js).
  const STATS = globalThis.XAF_STATS;

  const CLASS = Object.freeze({
    BAR: 'xaf-bar',
    // A chip mounted in the site's own header line (see `chipHosts` in sites/x.js).
    INLINE: 'xaf-inline',
    FLAGGED: 'xaf-flagged',
    ERROR: 'xaf-error',
    OFFER: 'xaf-offer',
    BUTTON: 'xaf-button',
    // Label controls. Tucked away until the chip is hovered.
    EXTRA: 'xaf-extra',
    ACTIVE: 'xaf-active',
    SCANLINE: 'xaf-scanline',
    SCAN_UP: 'xaf-scan-up',
    FILL: 'xaf-fill',
    PASS: 'xaf-pass',
    FAIL: 'xaf-fail',
  });
  // State on the site's own post element lives in data attributes. X rewrites the element's
  // whole class list on every hover, which wipes any class added here.
  const DATA = Object.freeze({
    ID: 'xafId',
    BAR: 'xafBar',
    HIDE: 'xafHide',
    ANIMATING: 'xafAnimating',
  });
  const HIDE = Object.freeze({ COLLAPSE: 'collapse', DIM: 'dim' });
  const TEXT = Object.freeze({
    SHOW: 'Show',
    HIDE: 'Hide',
    LABEL_AI: 'AI',
    LABEL_HUMAN: 'Human',
    LABEL_PROMPT: 'Label:',
    BLOCK: 'Block',
    BLOCKED: 'Blocked',
    BLOCK_OFFER: (count, handle) => `${count} posts from ${handle} scored as slop. Block?`,
    BLOCK_YES: 'Block',
    BLOCK_NO: 'Not now',
    UPSTREAM_ERROR: 'Upstream API error',
    WHY_NOT_ASKED: 'not asked, the post it replies to is unknown:',
    WHY_HARD_RULE: 'gate 2, AI hard rule, decisive alone:',
    WHY_HUMAN_VETO: 'gate 1, human tell, decisive alone:',
    WHY_SUM: 'gate 3, the weighted sum, shown for reference:',
  });
  const SETTING_KEYS = [STORE.THRESHOLD, STORE.MODE, STORE.LABELING, STORE.STATS];
  // Animated mode ends in the same collapsed state as collapse mode.
  const COLLAPSING_MODES = new Set([MODE.COLLAPSE, MODE.ANIMATED]);
  // Too little text to judge. These are never scored or hidden.
  const MIN_WORDS = 5;
  // Outside animated mode, posts are scored well before they scroll into view,
  // so flagged ones are already hidden when they arrive.
  const PRELOAD_MARGIN = '1500px 0px';
  // Animated mode scores a post when it is inside the top three quarters of the
  // viewport, so the scan on screen is the real wait for Jev.
  const STAGE_MARGIN = '0px 0px -25% 0px';
  const ANIMATION = Object.freeze({
    // Posts that come on screen together start one after another, top first.
    STAGGER_MS: 150,
    // One trip of the scan line, top to bottom or back up. It bounces until Jev
    // answers, and always finishes the first trip down.
    SCAN_PASS_MS: 1100,
    SCAN_FADE_MS: 200,
    VERDICT_FADE_MS: 400,
    PASS_HOLD_MS: 500,
    PASS_FADE_MS: 500,
    FAIL_HOLD_MS: 200,
    COLLAPSE_MS: 500,
    BAR_FADE_MS: 200,
    // Slows at the top and bottom, so the turn reads as a bounce.
    SCAN_EASING: 'ease-in-out',
    COLLAPSE_EASING: 'ease-in-out',
    // The shrink is done at this point of the collapse. The rest fades the red strip out.
    SHRINK_END_OFFSET: 0.8,
    // Height of the bar a collapsed post ends at, so the shrink lands on it.
    // Matches `min-height` of `.xaf-bar` in content.css.
    COLLAPSED_HEIGHT_PX: 28,
  });
  const ABORT_ERROR = 'AbortError';
  const OWN_BAR = `:scope > .${CLASS.BAR}`;
  // A host that grows by more than this with the chip inside did not keep its height.
  const HOST_GROWTH_TOLERANCE_PX = 0.5;
  // A site that wipes the chip out of its host this many times in a row, each within the
  // window of the one before, is redrawing that host for good. The chip then floats over
  // the item instead, so the two never race. One redraw now and then does not count up.
  const HOST_LOSS = Object.freeze({ MAX_IN_A_ROW: 3, WINDOW_MS: 2000 });
  const SCAN_DOWN_FRAMES = [{ top: '0%' }, { top: '100%' }];
  const SCAN_UP_FRAMES = [{ top: '100%' }, { top: '0%' }];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const settings = { ...DEFAULTS };
  const results = new Map(); // post id -> { p, features }
  const revealed = new Set(); // post ids the user chose to show
  const labeled = new Map(); // post id -> label given this session
  const animated = new Set(); // post ids whose inspection already played
  const awaitingStage = new WeakMap(); // element -> post
  const bars = new WeakMap(); // element -> its bar, which may be mounted outside the element
  const hostLosses = new WeakMap(); // element -> { count, at } of chips the site wiped from a host
  const animating = new WeakSet();
  const seen = new WeakSet();

  function send(message) {
    return chrome.runtime.sendMessage(message).then((response) => {
      if (response?.ok) return response.result;
      const error = new Error(response?.error ?? 'No response from background worker');
      error.detail = response?.detail ?? '';
      throw error;
    });
  }

  function button(label, onClick, isActive = false) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = CLASS.BUTTON;
    el.classList.toggle(CLASS.ACTIVE, isActive);
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  }

  // Contributions smaller than this are left out of the hover breakdown.
  const WHY_MIN_PULL = 0.05;

  // Hover text for the score: what pushed it up or down, strongest first.
  function whyText(result, percent) {
    if (!result.why) return '';
    const { bias, rows, hardRule, humanVeto } = result.why;
    const signed = (n) => `${n < 0 ? '-' : '+'}${Math.abs(n).toFixed(2)}`;
    const pulls = rows
      .filter((row) => row.asked && Math.abs(row.contribution) >= WHY_MIN_PULL)
      .map((row) => `${signed(row.contribution)}  ${row.id}  (answer ${row.value.toFixed(2)} x weight ${row.weight})`);
    const skipped = rows.filter((row) => !row.asked).map((row) => row.id);
    // A hard rule sets the score alone. The sum below it is only context.
    const decisive = hardRule
      ? [`${TEXT.WHY_HARD_RULE} ${hardRule.id} (Jev ${hardRule.value.toFixed(2)})`, TEXT.WHY_SUM]
      : humanVeto
        ? [`${TEXT.WHY_HUMAN_VETO} ${humanVeto.id} (Jev ${humanVeto.value.toFixed(2)})`, TEXT.WHY_SUM]
        : [];
    return [
      `Why ${percent}%`,
      ...decisive,
      `${signed(bias)}  starting point`,
      ...pulls,
      skipped.length ? `${TEXT.WHY_NOT_ASKED} ${skipped.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // Sites open the post on any click inside it. A chip in a site's header line can also
  // sit inside a `summary` or a link, where a click would fold the comment or navigate.
  const stopClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  function buildBar(element, post, result, isFlagged, isHidden) {
    const bar = document.createElement('div');
    bar.className = CLASS.BAR;
    bar.classList.toggle(CLASS.FLAGGED, isFlagged);
    bar.addEventListener('click', stopClick);

    const percent = Math.round(result.p * 100);
    const summary = document.createElement('span');
    summary.textContent = isFlagged ? `Likely AI · ${percent}%` : `AI ${percent}%`;
    summary.title = whyText(result, percent);
    bar.append(summary);

    if (isFlagged && settings.mode !== MODE.BADGE) {
      bar.append(
        button(isHidden ? TEXT.SHOW : TEXT.HIDE, () => {
          if (isHidden) revealed.add(post.id);
          else revealed.delete(post.id);
          render(element, post, result);
        }),
      );
    }

    if (settings.labeling) {
      const current = labeled.get(post.id);
      const onLabel = (label) => () => {
        labeled.set(post.id, label);
        send({ type: MSG.LABEL, post, features: result.features, label }).catch(console.warn);
        render(element, post, result);
      };
      const prompt = document.createElement('span');
      prompt.textContent = TEXT.LABEL_PROMPT;
      const extras = [
        prompt,
        button(TEXT.LABEL_AI, onLabel(LABEL.AI), current === LABEL.AI),
        button(TEXT.LABEL_HUMAN, onLabel(LABEL.HUMAN), current === LABEL.HUMAN),
      ];
      if (post.handle) extras.push(button(TEXT.BLOCK, () => blockAccount(post)));
      for (const extra of extras) extra.classList.add(CLASS.EXTRA);
      bar.append(...extras);
    }
    return bar;
  }

  function removeBars(parent) {
    for (const bar of parent.querySelectorAll(OWN_BAR)) bar.remove();
  }

  function clear(element) {
    // The tracked bar, wherever it is mounted.
    bars.get(element)?.remove();
    bars.delete(element);
    // And one left in the item by an earlier copy of this script, after an extension reload.
    removeBars(element);
    delete element.dataset[DATA.HIDE];
    element.dataset[DATA.BAR] = 'false';
    element.querySelector(`:scope > .${CLASS.OFFER}`)?.remove();
  }

  // Where the adapter wants this item's chip, best spot first. Sites without the hook,
  // and items whose chip kept getting wiped, get none.
  function chipHosts(element) {
    if ((hostLosses.get(element)?.count ?? 0) >= HOST_LOSS.MAX_IN_A_ROW) return [];
    try {
      return SITE.chipHosts?.(element) ?? [];
    } catch (error) {
      console.warn('[xaf]', error.message);
      return [];
    }
  }

  // Puts the chip in the first host where it shows up and the host keeps its height. A
  // taller host means the chip wrapped or took a row of its own. Returns whether one fit.
  function mountInline(element, bar) {
    const hosts = chipHosts(element);
    if (!hosts.length) return false;
    // A chip left behind when the site rebuilt the item but kept its header.
    for (const host of hosts) removeBars(host);
    bar.classList.add(CLASS.INLINE);
    for (const host of hosts) {
      const heightBefore = host.getBoundingClientRect().height;
      host.append(bar);
      const isShown = bar.getClientRects().length > 0;
      const grewBy = host.getBoundingClientRect().height - heightBefore;
      if (isShown && grewBy <= HOST_GROWTH_TOLERANCE_PX) return true;
    }
    bar.remove();
    bar.classList.remove(CLASS.INLINE);
    return false;
  }

  // A visible item's chip goes in the site's header line when the adapter names one and it
  // fits there. Everything else goes in the item: the row of a collapsed item stands in for
  // its hidden text, an error needs the room, and the floating chip is the fallback.
  function mount(element, bar, isFullRow) {
    bars.set(element, bar);
    if (isFullRow || !mountInline(element, bar)) element.append(bar);
  }

  // Scoring failed after its retries. The bar says why instead of showing a score.
  // Nothing is cached, so the post is scored again the next time X rebuilds it.
  function renderError(element, error) {
    console.warn('[xaf]', error.message, error.detail ?? '');
    clear(element);
    const bar = document.createElement('div');
    bar.className = `${CLASS.BAR} ${CLASS.ERROR}`;
    bar.textContent = `${TEXT.UPSTREAM_ERROR} \u00b7 ${error.message}`;
    if (error.detail) bar.title = error.detail;
    mount(element, bar, true);
    element.dataset[DATA.BAR] = 'true';
  }

  function render(element, post, result) {
    if (result.blocked) return renderBlocked(element, post);
    if (result.unscorable) return clear(element);
    clear(element);
    const isFlagged = result.p >= settings.threshold;
    const isHidden = isFlagged && !revealed.has(post.id);
    if (isHidden && COLLAPSING_MODES.has(settings.mode)) element.dataset[DATA.HIDE] = HIDE.COLLAPSE;
    else if (isHidden && settings.mode === MODE.DIM) element.dataset[DATA.HIDE] = HIDE.DIM;

    const wantsBar = isFlagged || settings.labeling;
    element.dataset[DATA.BAR] = String(wantsBar);
    if (!wantsBar) return;
    const isCollapsed = element.dataset[DATA.HIDE] === HIDE.COLLAPSE;
    mount(element, buildBar(element, post, result, isFlagged, isHidden), isCollapsed);
    if (isFlagged && wantsOffer(post, result)) element.append(buildOffer(post, result));
  }

  const isTooShort = (text) => !text || text.split(/\s+/).length < MIN_WORDS;
  // A post that cannot be judged: no text could be fetched, or too little of it. It is
  // remembered like any result, so it is not fetched again.
  const UNSCORABLE = Object.freeze({ unscorable: true });

  const BLOCKED = (handle) => ({ blocked: true, handle });

  async function resultFor(element, post) {
    if (!results.has(post.id)) {
      // A blocked account's post is settled before any text is fetched or sent.
      if (post.handle && (await send({ type: MSG.IS_BLOCKED, post }))) {
        results.set(post.id, BLOCKED(post.handle));
        return results.get(post.id);
      }
      // Some sites fetch the text first, such as a video's captions.
      if (SITE.loadText) post.text = await SITE.loadText(post);
      if (isTooShort(post.text)) {
        results.set(post.id, UNSCORABLE);
        return UNSCORABLE;
      }
      post.parentText = SITE.parentText(element, post);
      const result = await send({ type: MSG.CLASSIFY, post, threshold: settings.threshold });
      result.handle = post.handle;
      results.set(post.id, result);
      // Once per post per page, the moment the answer lands.
      STATS.record({ usage: result.usage, isFlagged: result.p >= settings.threshold });
    }
    return results.get(post.id);
  }

  // Hides every post from an account from now on, on every page.
  async function blockAccount(post) {
    await send({ type: MSG.BLOCK, post });
    for (const [id, result] of results) {
      if (result.handle === post.handle) results.set(id, BLOCKED(post.handle));
    }
    rerenderAll();
  }

  // The row for a post from a blocked account: no score, no Jev call.
  function renderBlocked(element, post) {
    clear(element);
    element.dataset[DATA.HIDE] = HIDE.COLLAPSE;
    const bar = document.createElement('div');
    bar.className = `${CLASS.BAR} ${CLASS.FLAGGED}`;
    bar.addEventListener('click', stopClick);
    const summary = document.createElement('span');
    summary.textContent = `${TEXT.BLOCKED} ${post.handle}`;
    bar.append(summary);
    element.append(bar);
    bars.set(element, bar);
    element.dataset[DATA.BAR] = 'true';
  }

  // Once an account's flagged posts reach the threshold, the next one carries an offer.
  const offered = new Set();
  function buildOffer(post, result) {
    const offer = document.createElement('div');
    offer.className = CLASS.OFFER;
    offer.addEventListener('click', stopClick);
    const text = document.createElement('span');
    text.textContent = TEXT.BLOCK_OFFER(result.flagCount, post.handle);
    offer.append(
      text,
      button(TEXT.BLOCK_YES, () => blockAccount(post)),
      button(TEXT.BLOCK_NO, () => {
        offered.add(post.handle);
        offer.remove();
      }),
    );
    return offer;
  }

  const wantsOffer = (post, result) =>
    Boolean(post.handle) &&
    (result.flagCount ?? 0) >= BLOCK_AFTER_FLAGS &&
    result.flagCount % BLOCK_AFTER_FLAGS === 0 &&
    !offered.has(post.handle);

  // Animated mode inspects a post once. A post already scored and shown under
  // another mode is left as it is.
  function wantsInspection(post) {
    return settings.mode === MODE.ANIMATED && !animated.has(post.id) && !results.has(post.id);
  }

  function addOverlay(element, ...classNames) {
    const overlay = document.createElement('div');
    overlay.className = classNames.join(' ');
    element.append(overlay);
    return overlay;
  }

  // A scan line runs down the post, bounces off the bottom, runs back up, and keeps
  // going until Jev has answered. The first trip down always finishes. After that it
  // stops wherever it is the moment the answer lands. Returns the line, left in place.
  async function playScan(element, pending) {
    let hasAnswer = false;
    const answered = pending.then(
      () => (hasAnswer = true),
      () => (hasAnswer = true),
    );

    const line = addOverlay(element, CLASS.SCANLINE);
    try {
      for (let pass = 0; element.isConnected; pass++) {
        const isUp = pass % 2 === 1;
        // Going up, the bright edge leads from the top of the line and the glow trails below.
        line.classList.toggle(CLASS.SCAN_UP, isUp);
        const trip = line.animate(isUp ? SCAN_UP_FRAMES : SCAN_DOWN_FRAMES, {
          duration: ANIMATION.SCAN_PASS_MS,
          easing: ANIMATION.SCAN_EASING,
          fill: 'forwards',
        });
        await (pass === 0 ? trip.finished : Promise.race([trip.finished, answered]));
        if (hasAnswer) {
          if (trip.playState === 'running') trip.pause();
          break;
        }
      }
    } catch (error) {
      line.remove();
      throw error;
    }
    return line;
  }

  // The verdict color fades in over the whole post while the scan line fades out.
  async function playVerdict(element, verdictClass, line) {
    const fill = addOverlay(element, CLASS.FILL, verdictClass);
    line.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: ANIMATION.SCAN_FADE_MS,
      fill: 'forwards',
    });
    await fill.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: ANIMATION.VERDICT_FADE_MS,
      fill: 'forwards',
    }).finished;
    line.remove();
    return fill;
  }

  // The container closes in on itself: it shrinks to bar height while its content
  // slides up at half that speed, so the top and bottom edges meet in the middle.
  // Returns the running animations, the shrink last. They hold their final frame.
  function startCollapse(element, fill) {
    const startHeight = element.getBoundingClientRect().height;
    const endHeight = ANIMATION.COLLAPSED_HEIGHT_PX;
    const slideUp = `translateY(${-(startHeight - endHeight) / 2}px)`;
    const offset = ANIMATION.SHRINK_END_OFFSET;
    const timing = {
      duration: ANIMATION.COLLAPSE_MS,
      easing: ANIMATION.COLLAPSE_EASING,
      fill: 'forwards',
    };

    const slides = [...element.children]
      .filter((child) => child !== fill)
      .map((child) =>
        child.animate(
          [{ transform: 'translateY(0)' }, { transform: slideUp, offset }, { transform: slideUp }],
          timing,
        ),
      );
    const shrink = element.animate(
      [
        { height: `${startHeight}px`, opacity: 1 },
        { height: `${endHeight}px`, opacity: 1, offset },
        { height: `${endHeight}px`, opacity: 0 },
      ],
      timing,
    );
    return [...slides, shrink];
  }

  function fadeInBar(element) {
    bars.get(element)?.animate([{ opacity: 0 }, { opacity: 1 }], ANIMATION.BAR_FADE_MS);
  }

  // Scan while Jev decides. Pass: green fades in, holds, fades out, and the post stays.
  // Fail: red fades in, then the post collapses.
  async function playInspection(element, post, delayMs) {
    animating.add(element);
    const isCurrent = () => element.isConnected && element.dataset[DATA.ID] === post.id;
    const held = [];
    let line;
    let fill;
    try {
      await sleep(delayMs);
      element.dataset[DATA.ANIMATING] = 'true';
      const pending = resultFor(element, post);
      line = await playScan(element, pending);
      let result;
      try {
        result = await pending;
      } catch (error) {
        // Let the post be inspected again when it next comes on screen.
        animated.delete(post.id);
        if (isCurrent()) renderError(element, error);
        return;
      }
      if (!isCurrent()) return;
      // Nothing to judge, or an account already blocked: no verdict to play.
      if (result.unscorable || result.blocked) {
        render(element, post, result);
        return;
      }

      const isFlagged = result.p >= settings.threshold;
      fill = await playVerdict(element, isFlagged ? CLASS.FAIL : CLASS.PASS, line);

      if (isFlagged) {
        await sleep(ANIMATION.FAIL_HOLD_MS);
        held.push(...startCollapse(element, fill));
        await held.at(-1).finished;
        // Collapse for real before the held last frame is released, so nothing flickers.
        if (isCurrent()) {
          render(element, post, result);
          fadeInBar(element);
        }
      } else {
        if (isCurrent()) render(element, post, result);
        await sleep(ANIMATION.PASS_HOLD_MS);
        await fill.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: ANIMATION.PASS_FADE_MS,
          fill: 'forwards',
        }).finished;
      }
    } catch (error) {
      // AbortError: the site dropped the node mid-animation.
      if (error.name !== ABORT_ERROR) console.warn('[xaf]', error.message);
    } finally {
      line?.remove();
      fill?.remove();
      delete element.dataset[DATA.ANIMATING];
      animating.delete(element);
      for (const animation of held) animation.cancel();
    }
  }

  function enterStage(element, delayMs) {
    const post = awaitingStage.get(element);
    awaitingStage.delete(element);
    stage.unobserve(element);
    if (!post || element.dataset[DATA.ID] !== post.id) return;
    if (!wantsInspection(post)) return process(element);

    animated.add(post.id);
    playInspection(element, post, delayMs);
  }

  const stage = new IntersectionObserver(
    (entries) => {
      entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        .forEach((entry, index) => enterStage(entry.target, index * ANIMATION.STAGGER_MS));
    },
    { rootMargin: STAGE_MARGIN },
  );

  async function process(element) {
    if (animating.has(element)) return;
    const post = SITE.extract(element);
    if (!post) return;
    // Saved with every label, so weights can be fitted per site.
    post.site = SITE.name;

    // Sites reuse nodes while scrolling, so a node can change posts.
    if (element.dataset[DATA.ID] !== post.id) {
      clear(element);
      element.dataset[DATA.ID] = post.id;
    }
    // When the adapter fetches the text later, its length is checked then.
    if (!SITE.loadText && isTooShort(post.text)) return;

    if (wantsInspection(post)) {
      awaitingStage.set(element, post);
      stage.observe(element);
      return;
    }

    try {
      const result = await resultFor(element, post);
      // The node may have been reused for another post while waiting.
      if (element.dataset[DATA.ID] === post.id) render(element, post, result);
    } catch (error) {
      if (element.dataset[DATA.ID] === post.id) renderError(element, error);
    }
  }

  const viewport = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) process(entry.target);
    },
    { rootMargin: PRELOAD_MARGIN },
  );

  // A chip that vanished from a host was wiped by the site. Chips in the item are not counted.
  function countHostLoss(element) {
    if (!bars.get(element)?.classList.contains(CLASS.INLINE)) return;
    const now = performance.now();
    const last = hostLosses.get(element);
    const isInARow = last && now - last.at < HOST_LOSS.WINDOW_MS;
    hostLosses.set(element, { count: isInARow ? last.count + 1 : 1, at: now });
  }

  function scan() {
    for (const element of document.querySelectorAll(SITE.itemSelector)) {
      if (!seen.has(element)) {
        seen.add(element);
        viewport.observe(element);
      } else if (element.dataset[DATA.ID]) {
        // Re-apply when the site re-rendered the node (bar gone) or reused it for another post.
        const lostBar = element.dataset[DATA.BAR] === 'true' && !bars.get(element)?.isConnected;
        if (lostBar) countHostLoss(element);
        const isStale = SITE.extract(element)?.id !== element.dataset[DATA.ID];
        if (lostBar || isStale) process(element);
      }
    }
  }

  function rerenderAll() {
    for (const element of document.querySelectorAll(SITE.itemSelector)) process(element);
  }

  let scanQueued = false;
  new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      scan();
    });
  }).observe(document.body, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((changes) => {
    for (const key of SETTING_KEYS) {
      if (changes[key]) settings[key] = changes[key].newValue ?? DEFAULTS[key];
    }
    // New weights change every probability. Features are cached in the worker.
    if (changes[STORE.WEIGHTS]) results.clear();
    STATS.setEnabled(settings.stats);
    rerenderAll();
  });

  chrome.storage.local.get(SETTING_KEYS).then((stored) => {
    for (const key of SETTING_KEYS) if (stored[key] !== undefined) settings[key] = stored[key];
    STATS.setEnabled(settings.stats);
    scan();
  });
})();
