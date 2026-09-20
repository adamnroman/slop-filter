// Finds tweets on the page, asks the background worker to score them, and hides
// the ones over the threshold. Also collects AI/human labels for fitting weights.
(() => {
  const { MSG, STORE, MODE, LABEL, DEFAULTS } = globalThis.XAF;

  const SEL = Object.freeze({
    TWEET: 'article[data-testid="tweet"]',
    TEXT: '[data-testid="tweetText"]',
    PERMALINK_TIME: 'a[href*="/status/"] time',
    QUOTE_CONTAINER: 'div[role="link"]',
  });
  const CLASS = Object.freeze({
    BAR: 'xaf-bar',
    FLAGGED: 'xaf-flagged',
    ERROR: 'xaf-error',
    BUTTON: 'xaf-button',
    ACTIVE: 'xaf-active',
    SCANLINE: 'xaf-scanline',
    SCAN_UP: 'xaf-scan-up',
    FILL: 'xaf-fill',
    PASS: 'xaf-pass',
    FAIL: 'xaf-fail',
  });
  // State on X's own tweet element lives in data attributes. X rewrites the element's
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
    UPSTREAM_ERROR: 'Upstream API error',
  });
  const STATUS_PATH = /^\/([^/]+)\/status\/(\d+)/;
  const SETTING_KEYS = [STORE.THRESHOLD, STORE.MODE, STORE.LABELING];
  // Animated mode ends in the same collapsed state as collapse mode.
  const COLLAPSING_MODES = new Set([MODE.COLLAPSE, MODE.ANIMATED]);
  // Too little text to judge. These are never scored or hidden.
  const MIN_WORDS = 8;
  // Outside animated mode, tweets are scored well before they scroll into view,
  // so flagged ones are already hidden when they arrive.
  const PRELOAD_MARGIN = '1500px 0px';
  // Animated mode scores a tweet when it is inside the top three quarters of the
  // viewport, so the scan on screen is the real wait for Jev.
  const STAGE_MARGIN = '0px 0px -25% 0px';
  const ANIMATION = Object.freeze({
    // Tweets that come on screen together start one after another, top first.
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
    // Height of the bar a collapsed tweet ends at, so the shrink lands on it.
    // Matches `min-height` of `.xaf-bar` in content.css.
    COLLAPSED_HEIGHT_PX: 28,
  });
  const ABORT_ERROR = 'AbortError';
  const SCAN_DOWN_FRAMES = [{ top: '0%' }, { top: '100%' }];
  const SCAN_UP_FRAMES = [{ top: '100%' }, { top: '0%' }];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const settings = { ...DEFAULTS };
  const results = new Map(); // tweet id -> { p, features }
  const revealed = new Set(); // tweet ids the user chose to show
  const labeled = new Map(); // tweet id -> label given this session
  const animated = new Set(); // tweet ids whose inspection already played
  const awaitingStage = new WeakMap(); // article -> tweet
  const animating = new WeakSet();
  const seen = new WeakSet();
  let focal = { id: null, text: null, node: null };

  function readText(node) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) out += child.data;
      else if (child.nodeName === 'IMG') out += child.alt;
      else out += readText(child);
    }
    return out;
  }

  function extractTweet(article) {
    const link = article.querySelector(SEL.PERMALINK_TIME)?.closest('a');
    const match = link?.getAttribute('href')?.match(STATUS_PATH);
    const textNode = article.querySelector(SEL.TEXT);
    // A tweet with no text of its own would otherwise pick up the quoted tweet's text.
    if (!match || !textNode || textNode.closest(SEL.QUOTE_CONTAINER)) return null;

    const text = readText(textNode).trim();
    return { id: match[2], handle: match[1], text };
  }

  function findFocal(statusId) {
    for (const article of document.querySelectorAll(SEL.TWEET)) {
      const tweet = extractTweet(article);
      if (tweet?.id === statusId) return { id: statusId, text: tweet.text, node: article };
    }
    return null;
  }

  // On a status page, tweets below the opened tweet are replies to it.
  function parentTextFor(article, tweet) {
    const statusId = location.pathname.match(STATUS_PATH)?.[2];
    if (!statusId || tweet.id === statusId) return null;
    if (focal.id !== statusId) focal = findFocal(statusId) ?? focal;
    if (focal.id !== statusId) return null;

    const isAboveFocal =
      focal.node.isConnected &&
      article.compareDocumentPosition(focal.node) & Node.DOCUMENT_POSITION_FOLLOWING;
    return isAboveFocal ? null : focal.text;
  }

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

  function buildBar(article, tweet, result, isFlagged, isHidden) {
    const bar = document.createElement('div');
    bar.className = CLASS.BAR;
    bar.classList.toggle(CLASS.FLAGGED, isFlagged);
    // X navigates to the tweet on any click inside the article.
    bar.addEventListener('click', (event) => event.stopPropagation());

    const percent = Math.round(result.p * 100);
    const summary = document.createElement('span');
    summary.textContent = isFlagged ? `Likely AI · ${percent}%` : `AI ${percent}%`;
    bar.append(summary);

    if (isFlagged && settings.mode !== MODE.BADGE) {
      bar.append(
        button(isHidden ? TEXT.SHOW : TEXT.HIDE, () => {
          if (isHidden) revealed.add(tweet.id);
          else revealed.delete(tweet.id);
          render(article, tweet, result);
        }),
      );
    }

    if (settings.labeling) {
      const current = labeled.get(tweet.id);
      const onLabel = (label) => () => {
        labeled.set(tweet.id, label);
        send({ type: MSG.LABEL, tweet, features: result.features, label }).catch(console.warn);
        render(article, tweet, result);
      };
      const prompt = document.createElement('span');
      prompt.textContent = TEXT.LABEL_PROMPT;
      bar.append(
        prompt,
        button(TEXT.LABEL_AI, onLabel(LABEL.AI), current === LABEL.AI),
        button(TEXT.LABEL_HUMAN, onLabel(LABEL.HUMAN), current === LABEL.HUMAN),
      );
    }
    return bar;
  }

  // Animated mode: hold the bar's space before the tweet is on screen, so the tweet
  // does not grow when the verdict bar arrives mid-animation.
  function reserveBar(article) {
    if (!settings.labeling || article.querySelector(`:scope > .${CLASS.BAR}`)) return;
    const placeholder = document.createElement('div');
    placeholder.className = CLASS.BAR;
    article.append(placeholder);
    article.dataset[DATA.BAR] = 'true';
  }

  function clear(article) {
    article.querySelector(`:scope > .${CLASS.BAR}`)?.remove();
    delete article.dataset[DATA.HIDE];
    article.dataset[DATA.BAR] = 'false';
  }

  // Scoring failed after its retries. The bar says why instead of showing a score.
  // Nothing is cached, so the tweet is scored again the next time X rebuilds it.
  function renderError(article, error) {
    console.warn('[xaf]', error.message, error.detail ?? '');
    clear(article);
    const bar = document.createElement('div');
    bar.className = `${CLASS.BAR} ${CLASS.ERROR}`;
    bar.textContent = `${TEXT.UPSTREAM_ERROR} \u00b7 ${error.message}`;
    if (error.detail) bar.title = error.detail;
    article.append(bar);
    article.dataset[DATA.BAR] = 'true';
  }

  function render(article, tweet, result) {
    clear(article);
    const isFlagged = result.p >= settings.threshold;
    const isHidden = isFlagged && !revealed.has(tweet.id);
    if (isHidden && COLLAPSING_MODES.has(settings.mode)) article.dataset[DATA.HIDE] = HIDE.COLLAPSE;
    else if (isHidden && settings.mode === MODE.DIM) article.dataset[DATA.HIDE] = HIDE.DIM;

    const wantsBar = isFlagged || settings.labeling;
    article.dataset[DATA.BAR] = String(wantsBar);
    if (wantsBar) article.append(buildBar(article, tweet, result, isFlagged, isHidden));
  }

  async function resultFor(article, tweet) {
    if (!results.has(tweet.id)) {
      tweet.parentText = parentTextFor(article, tweet);
      results.set(tweet.id, await send({ type: MSG.CLASSIFY, tweet }));
    }
    return results.get(tweet.id);
  }

  // Animated mode inspects a tweet once. A tweet already scored and shown under
  // another mode is left as it is.
  function wantsInspection(tweet) {
    return settings.mode === MODE.ANIMATED && !animated.has(tweet.id) && !results.has(tweet.id);
  }

  function addOverlay(article, ...classNames) {
    const overlay = document.createElement('div');
    overlay.className = classNames.join(' ');
    article.append(overlay);
    return overlay;
  }

  // A scan line runs down the tweet, bounces off the bottom, runs back up, and keeps
  // going until Jev has answered. The first trip down always finishes. After that it
  // stops wherever it is the moment the answer lands. Returns the line, left in place.
  async function playScan(article, pending) {
    let hasAnswer = false;
    const answered = pending.then(
      () => (hasAnswer = true),
      () => (hasAnswer = true),
    );

    const line = addOverlay(article, CLASS.SCANLINE);
    try {
      for (let pass = 0; article.isConnected; pass++) {
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

  // The verdict color fades in over the whole tweet while the scan line fades out.
  async function playVerdict(article, verdictClass, line) {
    const fill = addOverlay(article, CLASS.FILL, verdictClass);
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
  function startCollapse(article, fill) {
    const startHeight = article.getBoundingClientRect().height;
    const endHeight = ANIMATION.COLLAPSED_HEIGHT_PX;
    const slideUp = `translateY(${-(startHeight - endHeight) / 2}px)`;
    const offset = ANIMATION.SHRINK_END_OFFSET;
    const timing = {
      duration: ANIMATION.COLLAPSE_MS,
      easing: ANIMATION.COLLAPSE_EASING,
      fill: 'forwards',
    };

    const slides = [...article.children]
      .filter((child) => child !== fill)
      .map((child) =>
        child.animate(
          [{ transform: 'translateY(0)' }, { transform: slideUp, offset }, { transform: slideUp }],
          timing,
        ),
      );
    const shrink = article.animate(
      [
        { height: `${startHeight}px`, opacity: 1 },
        { height: `${endHeight}px`, opacity: 1, offset },
        { height: `${endHeight}px`, opacity: 0 },
      ],
      timing,
    );
    return [...slides, shrink];
  }

  function fadeInBar(article) {
    article
      .querySelector(`:scope > .${CLASS.BAR}`)
      ?.animate([{ opacity: 0 }, { opacity: 1 }], ANIMATION.BAR_FADE_MS);
  }

  // Scan while Jev decides. Pass: green fades in, holds, fades out, and the tweet stays.
  // Fail: red fades in, then the tweet collapses.
  async function playInspection(article, tweet, delayMs) {
    animating.add(article);
    const isCurrent = () => article.isConnected && article.dataset[DATA.ID] === tweet.id;
    const held = [];
    let line;
    let fill;
    try {
      await sleep(delayMs);
      article.dataset[DATA.ANIMATING] = 'true';
      const pending = resultFor(article, tweet);
      line = await playScan(article, pending);
      let result;
      try {
        result = await pending;
      } catch (error) {
        // Let the tweet be inspected again when it next comes on screen.
        animated.delete(tweet.id);
        if (isCurrent()) renderError(article, error);
        return;
      }
      if (!isCurrent()) return;

      const isFlagged = result.p >= settings.threshold;
      fill = await playVerdict(article, isFlagged ? CLASS.FAIL : CLASS.PASS, line);

      if (isFlagged) {
        await sleep(ANIMATION.FAIL_HOLD_MS);
        held.push(...startCollapse(article, fill));
        await held.at(-1).finished;
        // Collapse for real before the held last frame is released, so nothing flickers.
        if (isCurrent()) {
          render(article, tweet, result);
          fadeInBar(article);
        }
      } else {
        if (isCurrent()) render(article, tweet, result);
        await sleep(ANIMATION.PASS_HOLD_MS);
        await fill.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: ANIMATION.PASS_FADE_MS,
          fill: 'forwards',
        }).finished;
      }
    } catch (error) {
      // AbortError: X dropped the node mid-animation.
      if (error.name !== ABORT_ERROR) console.warn('[xaf]', error.message);
    } finally {
      line?.remove();
      fill?.remove();
      delete article.dataset[DATA.ANIMATING];
      animating.delete(article);
      for (const animation of held) animation.cancel();
    }
  }

  function enterStage(article, delayMs) {
    const tweet = awaitingStage.get(article);
    awaitingStage.delete(article);
    stage.unobserve(article);
    if (!tweet || article.dataset[DATA.ID] !== tweet.id) return;
    if (!wantsInspection(tweet)) return process(article);

    animated.add(tweet.id);
    playInspection(article, tweet, delayMs);
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

  async function process(article) {
    if (animating.has(article)) return;
    const tweet = extractTweet(article);
    if (!tweet) return;

    // X reuses article nodes while scrolling, so a node can change tweets.
    if (article.dataset[DATA.ID] !== tweet.id) {
      clear(article);
      article.dataset[DATA.ID] = tweet.id;
    }
    if (tweet.text.split(/\s+/).length < MIN_WORDS) return;

    if (wantsInspection(tweet)) {
      reserveBar(article);
      awaitingStage.set(article, tweet);
      stage.observe(article);
      return;
    }

    try {
      const result = await resultFor(article, tweet);
      // The node may have been reused for another tweet while waiting.
      if (article.dataset[DATA.ID] === tweet.id) render(article, tweet, result);
    } catch (error) {
      if (article.dataset[DATA.ID] === tweet.id) renderError(article, error);
    }
  }

  const viewport = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) process(entry.target);
    },
    { rootMargin: PRELOAD_MARGIN },
  );

  function scan() {
    for (const article of document.querySelectorAll(SEL.TWEET)) {
      if (!seen.has(article)) {
        seen.add(article);
        viewport.observe(article);
      } else if (article.dataset[DATA.ID]) {
        // Re-apply when X re-rendered the node (bar gone) or reused it for another tweet.
        const lostBar =
          article.dataset[DATA.BAR] === 'true' && !article.querySelector(`:scope > .${CLASS.BAR}`);
        const isStale = extractTweet(article)?.id !== article.dataset[DATA.ID];
        if (lostBar || isStale) process(article);
      }
    }
  }

  function rerenderAll() {
    for (const article of document.querySelectorAll(SEL.TWEET)) process(article);
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
    rerenderAll();
  });

  chrome.storage.local.get(SETTING_KEYS).then((stored) => {
    for (const key of SETTING_KEYS) if (stored[key] !== undefined) settings[key] = stored[key];
    scan();
  });
})();
