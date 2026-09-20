// Site adapter for x.com. The core in content.js is site-neutral and only talks to
// `globalThis.XAF_SITE`:
//   name          short site id, saved on every label
//   itemSelector  matches every element that might be a scorable post
//   extract(el)   -> { id, handle, text } or null. Called often, so keep it cheap.
//   parentText(el, post) -> text of the post being replied to, or null. Called once.
//   chipHosts(el) -> optional. Elements in the site's own header line that the score chip
//                 may be mounted in, best spot first. The chip goes at the end of the first
//                 one where it shows up and the host stays the same height, as an inline
//                 pill. A host belongs to one item only. Without the hook, with an empty
//                 list, or when no host fits, the chip floats over a corner of the item.
//                 A collapsed item's row and an error always go in the item.
(() => {
  const { readText } = globalThis.XAF_DOM;

  const SEL = Object.freeze({
    TWEET: 'article[data-testid="tweet"]',
    TEXT: '[data-testid="tweetText"]',
    PERMALINK_TIME: 'a[href*="/status/"] time',
    QUOTE_CONTAINER: 'div[role="link"]',
  });
  const STATUS_PATH = /^\/([^/]+)\/status\/(\d+)/;

  let focal = { id: null, text: null, node: null };

  function extract(article) {
    const link = article.querySelector(SEL.PERMALINK_TIME)?.closest('a');
    const match = link?.getAttribute('href')?.match(STATUS_PATH);
    const textNode = article.querySelector(SEL.TEXT);
    // A tweet with no text of its own would otherwise pick up the quoted tweet's text.
    if (!match || !textNode || textNode.closest(SEL.QUOTE_CONTAINER)) return null;
    return { id: match[2], handle: match[1], text: readText(textNode).trim() };
  }

  function findFocal(statusId) {
    for (const article of document.querySelectorAll(SEL.TWEET)) {
      const tweet = extract(article);
      if (tweet?.id === statusId) return { id: statusId, text: tweet.text, node: article };
    }
    return null;
  }

  // On a status page, tweets below the opened tweet are replies to it.
  function parentText(article, tweet) {
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
