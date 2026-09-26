// Site adapter for x.com. The core in content.js is site-neutral and only talks to
// `globalThis.XAF_SITE`:
//   name          short site id, saved on every label
//   itemSelector  matches every element that might be a scorable post
//   extract(el)   -> { id, handle, text } or null. Called often, so keep it cheap.
//                 May add `isReply: true` for a reply whose parent might not be on the page.
//   parentText(el, post) -> text of the post being replied to, or null. Called once.
//   chipHosts(el) -> optional. Elements in the site's own header line that the score chip
//                 may be mounted in, best spot first. The chip goes at the end of the first
//                 one where it shows up and the host stays the same height, as an inline
//                 pill. A host belongs to one item only. Without the hook, with an empty
//                 list, or when no host fits, the chip floats over a corner of the item.
//                 A collapsed item's row and an error always go in the item.
//   settings(shared) -> optional. Called once with the live settings object, so an adapter
//                 can turn one of its item kinds off from the options page.
(() => {
  const { readText } = globalThis.XAF_DOM;

  const SEL = Object.freeze({
    TWEET: 'article[data-testid="tweet"]',
    TEXT: '[data-testid="tweetText"]',
    PERMALINK_TIME: 'a[href*="/status/"] time',
    QUOTE_CONTAINER: 'div[role="link"]',
    AVATAR: '[data-testid="Tweet-User-Avatar"]',
    CELL: '[data-testid="cellInnerDiv"]',
  });
  // X draws a conversation as a thin vertical line that joins the avatars. A tweet that
  // answers the one right above it has a short piece of that line above its own avatar.
  const THREAD_LINE = Object.freeze({ WIDTH_PX: 2, MIN_HEIGHT_PX: 6, SLACK_PX: 2 });
  const STATUS_PATH = /^\/([^/]+)\/status\/(\d+)/;
  // X labels a reply shown without the tweet it answers.
  const REPLY_LABEL = 'Replying to @';

  let focal = { id: null, text: null, node: null };

  function extract(article) {
    const link = article.querySelector(SEL.PERMALINK_TIME)?.closest('a');
    const match = link?.getAttribute('href')?.match(STATUS_PATH);
    const textNode = article.querySelector(SEL.TEXT);
    // A tweet with no text of its own would otherwise pick up the quoted tweet's text.
    if (!match || !textNode || textNode.closest(SEL.QUOTE_CONTAINER)) return null;
    // The model will not treat a pivot as decisive on a reply it cannot check against
    // the tweet it answers, so say when this is one.
    const isReply = article.textContent.includes(REPLY_LABEL);
    return { id: match[2], handle: match[1], text: readText(textNode).trim(), isReply };
  }

  function findFocal(statusId) {
    for (const article of document.querySelectorAll(SEL.TWEET)) {
      const tweet = extract(article);
      if (tweet?.id === statusId) return { id: statusId, text: tweet.text, node: article };
    }
    return null;
  }

  function isJoinedToTweetAbove(article) {
    const avatarTop = article.querySelector(SEL.AVATAR)?.getBoundingClientRect().top;
    if (avatarTop === undefined) return false;
    for (const div of article.querySelectorAll('div')) {
      const box = div.getBoundingClientRect();
      const isLine = Math.round(box.width) === THREAD_LINE.WIDTH_PX && box.height >= THREAD_LINE.MIN_HEIGHT_PX;
      if (isLine && box.bottom <= avatarTop + THREAD_LINE.SLACK_PX) return true;
    }
    return false;
  }

  // The tweet this one answers, when X shows them joined, in a timeline or on a status
  // page. A person continuing their own thread is not replying to anyone, so that
  // gives no parent.
  function joinedParent(article, tweet) {
    const above = article.closest(SEL.CELL)?.previousElementSibling?.querySelector(SEL.TWEET);
    const parent = above && extract(above);
    if (!parent || parent.handle === tweet.handle) return null;
    return parent.text || null;
  }

  // The tweet it is joined to. Failing that, on a status page, the opened tweet it sits under.
  function parentText(article, tweet) {
    if (isJoinedToTweetAbove(article)) return joinedParent(article, tweet);
    return focalParent(article, tweet);
  }

  // On a status page, tweets below the opened tweet are replies to it.
  function focalParent(article, tweet) {
    const statusId = location.pathname.match(STATUS_PATH)?.[2];
    if (!statusId || tweet.id === statusId) return null;
    if (focal.id !== statusId) focal = findFocal(statusId) ?? focal;
    if (focal.id !== statusId) return null;

    const isAboveFocal =
      focal.node.isConnected &&
      article.compareDocumentPosition(focal.node) & Node.DOCUMENT_POSITION_FOLLOWING;
    return isAboveFocal ? null : focal.text;
  }

  globalThis.XAF_SITE = Object.freeze({ name: 'x', itemSelector: SEL.TWEET, extract, parentText });
})();
