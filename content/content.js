/**
 * xthread — content script
 * Injected into x.com pages to extract tweet threads.
 */

/**
 * Polls for article[data-testid="tweet"] elements until the count stabilises
 * for three consecutive checks (300 ms apart) or the timeout is reached.
 *
 * @param {number} timeoutMs
 * @returns {Promise<NodeList>}
 */
function waitForTweets(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let lastCount = -1;
    let stableCount = 0;
    const interval = 300;
    let elapsed = 0;

    function check() {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      const count = articles.length;

      if (count > 0 && count === lastCount) {
        stableCount++;
        if (stableCount >= 3) {
          resolve(articles);
          return;
        }
      } else {
        stableCount = 0;
      }
      lastCount = count;

      elapsed += interval;
      if (elapsed >= timeoutMs) {
        if (count > 0) {
          resolve(articles);
        } else {
          reject(new Error('Timed out waiting for tweet articles to appear.'));
        }
        return;
      }

      setTimeout(check, interval);
    }

    setTimeout(check, interval);
  });
}

/**
 * Returns the Twitter handle for the author of an article.
 * Skips handles found inside nested quoted tweets.
 *
 * @param {Element} article
 * @returns {string}
 */
function extractHandle(article) {
  const nestedArticle = article.querySelector('article[data-testid="tweet"]');
  const links = article.querySelectorAll('[data-testid="User-Name"] a[href^="/"]');
  for (const link of links) {
    if (nestedArticle && nestedArticle.contains(link)) continue;
    const href = link.getAttribute('href') || '';
    const segment = href.replace(/^\//, '').split('/')[0];
    if (segment) return segment.toLowerCase();
  }
  return '';
}

/**
 * Finds the numeric tweet ID from <a> elements whose href contains /status/<id>.
 *
 * @param {Element} article
 * @returns {string}
 */
function extractTweetId(article) {
  const links = article.querySelectorAll('a[href]');
  for (const a of links) {
    const href = a.getAttribute('href') || '';
    const match = href.match(/\/status\/(\d+)/);
    if (match) return match[1];
  }
  return '';
}

/**
 * Walks the child nodes of [data-testid="tweetText"] and builds a plain-text
 * representation of the tweet body. Quoted (nested) tweets are skipped.
 * Appends attachment markers when present.
 *
 * @param {Element} article
 * @returns {string}
 */
function extractText(article) {
  const quotedTweet = article.querySelector('article[data-testid="tweet"]');

  const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
  let text = '';

  if (tweetTextEl) {
    text = walkNodes(tweetTextEl, quotedTweet);
  }

  const attachments = article.querySelector('[data-testid="attachments"]');
  if (attachments) {
    const hasVideo =
      attachments.querySelector('video') !== null ||
      attachments.querySelector('[data-testid="videoPlayer"]') !== null ||
      attachments.querySelector('[data-testid="videoComponent"]') !== null;
    if (hasVideo) {
      text += '\n[video]';
    } else {
      const hasImage =
        attachments.querySelector('img') !== null ||
        attachments.querySelector('[data-testid="tweetPhoto"]') !== null;
      if (hasImage) {
        text += '\n[image]';
      }
    }
  }

  return text.replace(/\u200B/g, '').trim();
}

/**
 * Recursively walks a node's children, building text while skipping the
 * subtree rooted at `skipNode` (used to exclude quoted tweets).
 *
 * @param {Node} node
 * @param {Element|null} skipNode
 * @returns {string}
 */
function walkNodes(node, skipNode) {
  let result = '';
  for (const child of node.childNodes) {
    if (skipNode && (child === skipNode || skipNode.contains(child))) {
      continue;
    }
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'img') {
        result += child.getAttribute('alt') || '';
      } else if (tag === 'br') {
        result += '\n';
      } else if (tag === 'a') {
        result += child.textContent;
      } else {
        result += walkNodes(child, skipNode);
      }
    }
  }
  return result;
}

/**
 * Searches the first 50 characters of `text` for a "x/y" numbering marker
 * and returns { current, total } as integers, or null if not found.
 *
 * @param {string} text
 * @returns {{ current: number, total: number } | null}
 */
function extractNumberMarker(text) {
  const sample = text.slice(0, 50);
  const re = /(?:^|\s)(\d{1,3})\s*\/\s*(\d{1,3})(?:\s|[.,!?]|$)/;
  const match = re.exec(sample);
  if (!match) return null;
  return { current: parseInt(match[1], 10), total: parseInt(match[2], 10) };
}

/**
 * Main extraction logic.
 *
 * @returns {Promise<{ok: boolean, author?: string, tweetCount?: number, text?: string, warning?: string, error?: string}>}
 */
/**
 * Harvests any currently visible thread tweets into the accumulator map.
 * Must be called while the tweets are still in the DOM.
 *
 * @param {string} focalAuthor
 * @param {Map<string, {text: string, marker: object|null}>} acc  keyed by tweet ID
 */
/**
 * Clicks any visible "Show more" / "Mehr anzeigen" buttons inside thread articles
 * to expand truncated tweet text. Returns the number of buttons clicked.
 *
 * @param {string} focalAuthor
 * @param {Set<string>} expandedIds  tweet IDs already expanded, to avoid re-clicking
 * @returns {number}
 */
function expandShowMore(focalAuthor, expandedIds) {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  let clicked = 0;
  for (const article of articles) {
    if (extractHandle(article) !== focalAuthor) continue;
    const id = extractTweetId(article);
    if (!id || expandedIds.has(id)) continue;
    // X renders the button as a div/span with role="button" inside tweetText,
    // or as a standalone element after tweetText. Match by text content.
    const candidates = article.querySelectorAll('[role="button"], button');
    for (const btn of candidates) {
      const label = btn.textContent.trim().toLowerCase();
      if (label === 'show more' || label === 'mehr anzeigen' || label === 'show more…' || label === 'mehr anzeigen…') {
        btn.click();
        expandedIds.add(id);
        clicked++;
        break;
      }
    }
  }
  return clicked;
}

function harvestVisible(focalAuthor, acc) {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const article of articles) {
    if (extractHandle(article) !== focalAuthor) continue;
    const id = extractTweetId(article);
    if (!id || acc.has(id)) continue;
    const text = extractText(article);
    const marker = extractNumberMarker(text);
    acc.set(id, { text, marker });
  }
}

async function buildThread() {
  // 1. Verify we're on a /status/ page.
  const pathname = window.location.pathname;
  const statusMatch = pathname.match(/\/status\/(\d+)/);
  if (!statusMatch) {
    return { ok: false, error: 'Not on a tweet status page. Navigate to an individual tweet or thread.' };
  }
  const focalId = statusMatch[1];

  // 2. Wait for initial tweets to appear and stabilise.
  let articles;
  try {
    articles = await waitForTweets(5000);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  // 3. Find the focal article.
  let focalArticle = null;
  for (const article of articles) {
    const timeEl = article.querySelector('time');
    if (!timeEl) continue;
    const parentLink = timeEl.closest('a');
    if (parentLink && (parentLink.getAttribute('href') || '').includes(`/status/${focalId}`)) {
      focalArticle = article;
      break;
    }
  }
  if (!focalArticle) focalArticle = articles[0];

  // 3b. Extract posting date from the focal tweet's time element.
  const focalDate = (() => {
    const timeEl = focalArticle.querySelector('time');
    return timeEl ? timeEl.getAttribute('datetime') : null;
  })();

  // 4. Determine the thread author.
  const focalAuthor = extractHandle(focalArticle);
  if (!focalAuthor) {
    return { ok: false, error: 'Could not determine the thread author handle.' };
  }

  // 5. Scroll-and-harvest loop.
  // We accumulate tweets into a Map (id → data) as they pass through the DOM.
  // Each scroll step: expand truncated tweets, harvest, scroll, wait, repeat.
  const acc = new Map();
  const expandedIds = new Set();

  expandShowMore(focalAuthor, expandedIds);
  await new Promise(r => setTimeout(r, 400));
  harvestVisible(focalAuthor, acc);

  let lastSize = -1;
  let stableRounds = 0;
  const maxRounds = 40;       // safety cap (~40 × 600ms = 24s max)
  const scrollWait = 600;     // ms to wait after each scroll for React to render

  for (let round = 0; round < maxRounds; round++) {
    // Check if we already have the full thread via xx/yy markers.
    let knownTotal = null;
    for (const { marker } of acc.values()) {
      if (marker && marker.total > 1) { knownTotal = marker.total; break; }
    }
    if (knownTotal && acc.size >= knownTotal) break;

    // Scroll down one viewport height.
    window.scrollBy(0, window.innerHeight);

    // Wait for React to render new tweets.
    await new Promise(r => setTimeout(r, scrollWait));

    // Expand any truncated tweets now in view, wait briefly if any were clicked.
    const clicked = expandShowMore(focalAuthor, expandedIds);
    if (clicked > 0) await new Promise(r => setTimeout(r, 400));

    // Harvest whatever is now in the DOM.
    harvestVisible(focalAuthor, acc);

    // Stop if count hasn't grown for 3 consecutive rounds (end of thread).
    if (acc.size === lastSize) {
      stableRounds++;
      if (stableRounds >= 3) break;
    } else {
      stableRounds = 0;
    }
    lastSize = acc.size;
  }

  if (acc.size === 0) {
    return { ok: false, error: 'No tweets found for the thread author.' };
  }

  // 6. Sort accumulated tweets by xx/yy marker if available, otherwise keep insertion order.
  let tweets = Array.from(acc.values());
  const allMarkered = tweets.every(t => t.marker !== null);
  if (allMarkered) {
    tweets.sort((a, b) => a.marker.current - b.marker.current);
  }

  // 7. Validate x/y markers.
  let warning = null;
  const markered = tweets.filter((t) => t.marker !== null);
  if (markered.length > 0) {
    const totals = [...new Set(markered.map((t) => t.marker.total))];
    const expectedTotal = totals[0];
    if (totals.length > 1) {
      warning = 'Inconsistent thread totals found in markers — thread may be incomplete.';
    } else {
      const currents = markered.map((t) => t.marker.current).sort((a, b) => a - b);
      const missing = [];
      for (let i = 1; i <= expectedTotal; i++) {
        if (!currents.includes(i)) missing.push(i);
      }
      if (missing.length > 0) {
        warning = `Thread may be incomplete — missing tweet(s): ${missing.join(', ')} of ${expectedTotal}.`;
      }
    }
  }

  // 8. Build output string — use author's xx/yy marker as label, stripped from text body.
  const parts = tweets.map((tweet) => {
    if (!tweet.marker) return tweet.text;
    // Remove the original "x/y" marker from the start of the text to avoid duplication.
    const cleaned = tweet.text.replace(/^\s*\d{1,3}\s*\/\s*\d{1,3}\s*/, '');
    return `[${tweet.marker.current}/${tweet.marker.total}]\n${cleaned}`;
  });

  const text = parts.join('\n\n');

  return {
    ok: true,
    author: focalAuthor,
    tweetCount: tweets.length,
    date: focalDate,
    text,
    ...(warning ? { warning } : {}),
  };
}

// ── Entry point ────────────────────────────────────────────────────────────────

(async () => {
  // Reset flag so re-injection always works fresh.
  window.__xthread_running = false;
  window.__xthread_running = true;

  try {
    const result = await buildThread();
    chrome.runtime.sendMessage({ type: 'THREAD_RESULT', payload: result });
  } catch (e) {
    chrome.runtime.sendMessage({
      type: 'THREAD_RESULT',
      payload: { ok: false, error: e.message },
    });
  } finally {
    window.__xthread_running = false;
  }
})();
