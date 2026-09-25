# Privacy policy

Last updated: 2026-09-25

Slop Filter is a browser extension that hides AI-generated posts. It has no server of its own, no account, no analytics, and no ads. This page says what it reads, what leaves your browser, and what stays in it.

## What it reads

On the sites it supports (x.com, linkedin.com, reddit.com, and youtube.com), it reads the text of posts and comments that are on or near your screen, along with the author's handle. When a post is a reply, it may also read the text of the post being replied to. For a YouTube comment that is the comment it replies to, or the video's title. It does not read your messages, your password, your cookies, or pages on any other site.

## What leaves your browser

To score a post, the extension sends that post's text, and the text of the post it replies to when there is one, to the Jev model. It reaches Jev at one of two places, and you choose which on the options page:

- The TypeSafe API at `api.typesafe.ai`, using the TypeSafe API key you entered. This is the default.
- OpenRouter at `openrouter.ai`, using the OpenRouter API key you entered. OpenRouter forwards the text to TypeSafe and bills your OpenRouter credits. See the [OpenRouter privacy policy](https://openrouter.ai/privacy).

That is the only place data is sent.

- Author handles are not sent.
- Nothing is sent to the developers of Slop Filter. We never see your feed, your key, or your labels.
- TypeSafe handles what it receives under its own terms. See the [TypeSafe privacy policy](https://typesafe.ai/legal/privacy-policy) and [data processing agreement](https://typesafe.ai/legal/data-processing). TypeSafe states that it does not train its models on customer requests.

## What stays in your browser

Stored in Chrome's local extension storage, on your device only:

- Your TypeSafe API key.
- Your settings: the threshold, what happens to a flagged post, and the other switches on the options page.
- Your labels. When you mark a post as AI or Human, the extension saves that post's text, the text of the post it replied to if any, the author's handle, the site, its scores, and your label. They leave your browser only if you click "Export labels.json" and share the file yourself. "Clear labels" on the options page deletes them.

Removing the extension deletes all of it.

## What we do not do

- We do not sell or share your data.
- We do not use your data for advertising, profiling, or anything other than scoring posts for you.
- We do not track you across sites.

## Changes

If this policy changes, the new version is published at this address with a new date.

## Contact

Open an issue at https://github.com/adamnroman/slop-filter/issues.
