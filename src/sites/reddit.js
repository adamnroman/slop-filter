// Site adapter for www.reddit.com (the current site, not old.reddit.com).
// See sites/x.js for the adapter contract.
//
// Reddit's posts and comments are web components (`shreddit-post`, `shreddit-comment`)
// with a sealed layout. A bar placed directly inside one may not render, and hiding its
// children leaves its own vote and header chrome behind. So the items here are the plain
// containers around or inside them:
//   - a feed post:     the `article` that wraps the `shreddit-post`. Hiding it hides the card.
//   - an opened post:  its `[slot="text-body"]`. Only the text folds away.
//   - a comment:       its `[slot="comment"]`. Only its text folds away, replies stay.
//
// This markup was taken from other open source Reddit extensions, not inspected live.
// If scores stop showing up, check these selectors first.
(() => {
  const { readText, hash } = globalThis.XAF_DOM;

  const SEL = Object.freeze({
    FEED_CARD: 'article',
    POST: 'shreddit-post',
    // Direct child only. An `article` that merely contains a post somewhere inside it
    // could be a whole page, and collapsing that would hide everything.
    CARD_POST: ':scope > shreddit-post',
    POST_BODY: 'shreddit-post [slot="text-body"]',
    COMMENT: 'shreddit-comment',
    COMMENT_BODY: 'shreddit-comment [slot="comment"]',
    BODY_IN_POST: '[slot="text-body"]',
    BODY_IN_COMMENT: '[slot="comment"]',
    TITLE: '[id^="post-title"], [slot="title"]',
  });
  const ATTR = Object.freeze({ TITLE: 'post-title', AUTHOR: 'author', COMMENT_ID: 'thingid' });
  const ID_PREFIX = Object.freeze({ POST: 'reddit:post:', COMMENT: 'reddit:comment:' });
  // The extension's own bar and overlays sit inside these containers. They are not post text.
  const OWN_ELEMENTS = '[class^="xaf-"]';

  const textOf = (node) => (node ? readText(node, OWN_ELEMENTS).trim() : '');

  // A post is its title plus whatever body text is on the page. In a feed that is
  // Reddit's preview of the body, and for a link or image post it is the title alone.
  function postText(post) {
    const title = post.getAttribute(ATTR.TITLE) ?? textOf(post.querySelector(SEL.TITLE));
    const body = textOf(post.querySelector(SEL.BODY_IN_POST));
    return [title, body].filter(Boolean).join('\n\n');
  }

  function fromPost(post) {
    if (!post) return null;
    const text = postText(post);
    const handle = post.getAttribute(ATTR.AUTHOR) ?? '';
    return { id: ID_PREFIX.POST + (post.id || hash(`${handle}\n${text}`)), handle, text };
  }

  function fromComment(body) {
    const comment = body.closest(SEL.COMMENT);
    const text = textOf(body);
    const handle = comment.getAttribute(ATTR.AUTHOR) ?? '';
    const id = comment.getAttribute(ATTR.COMMENT_ID) ?? hash(`${handle}\n${text}`);
    return { id: ID_PREFIX.COMMENT + id, handle, text };
  }

  function extract(element) {
    if (element.matches(SEL.COMMENT_BODY)) return fromComment(element);
    if (element.matches(SEL.FEED_CARD)) return fromPost(element.querySelector(SEL.CARD_POST));
    // The text body of an opened post. In a feed the card above already covers it.
    if (element.closest(SEL.POST).parentElement?.matches(SEL.FEED_CARD)) return null;
    return fromPost(element.closest(SEL.POST));
  }

  // A comment replies to the comment it is nested under, or to the post.
  function parentText(element) {
    if (!element.matches(SEL.COMMENT_BODY)) return null;
    const parentComment = element.closest(SEL.COMMENT).parentElement?.closest(SEL.COMMENT);
    if (parentComment) return textOf(parentComment.querySelector(SEL.BODY_IN_COMMENT)) || null;
    const post = document.querySelector(SEL.POST);
    return post ? postText(post) || null : null;
  }

  globalThis.XAF_SITE = Object.freeze({
    name: 'reddit',
    itemSelector: `${SEL.FEED_CARD}, ${SEL.POST_BODY}, ${SEL.COMMENT_BODY}`,
    extract,
    parentText,
  });
})();
