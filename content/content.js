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

  return text.trim();
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
async function buildThread() {
  // 1. Verify we're on a /status/ page.
  const pathname = window.location.pathname;
  const statusMatch = pathname.match(/\/status\/(\d+)/);
  if (!statusMatch) {
    return { ok: false, error: 'Not on a tweet status page. Navigate to an individual tweet or thread.' };
  }
  const focalId = statusMatch[1];

  // 2. Wait for tweets to appear and stabilise.
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

  // 4. Determine the thread author.
  const focalAuthor = extractHandle(focalArticle);
  if (!focalAuthor) {
    return { ok: false, error: 'Could not determine the thread author handle.' };
  }

  // 5. Filter articles by matching author, deduplicate by tweet ID.
  const seen = new Set();
  const threadArticles = [];
  for (const article of articles) {
    const handle = extractHandle(article);
    if (handle !== focalAuthor) continue;
    const id = extractTweetId(article);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    threadArticles.push(article);
  }

  if (threadArticles.length === 0) {
    return { ok: false, error: 'No tweets found for the thread author.' };
  }

  // 6. Extract text and number markers from each tweet.
  const tweets = threadArticles.map((article) => {
    const text = extractText(article);
    const marker = extractNumberMarker(text);
    return { text, marker };
  });

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

  // 8. Build output string.
  const parts = tweets.map((tweet, idx) => {
    const label = tweet.marker
      ? `[${tweet.marker.current}/${tweet.marker.total}]`
      : `[${idx + 1}/${tweets.length}]`;
    return `${label}\n${tweet.text}`;
  });

  const text = parts.join('\n\n---\n\n');

  return {
    ok: true,
    author: focalAuthor,
    tweetCount: tweets.length,
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
