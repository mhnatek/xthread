/**
 * xthread — popup script
 * Orchestrates tab querying, content script injection, and UI updates.
 */

'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const statusEl    = document.getElementById('status');
const outputEl    = document.getElementById('output');
const btnCopy     = document.getElementById('btn-copy');
const btnSave     = document.getElementById('btn-save');
const btnClear    = document.getElementById('btn-clear');
const tweetCount  = document.getElementById('tweet-count');
const errorBox    = document.getElementById('error-box');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Display an error message in the error box and update the status bar.
 * @param {string} message
 * @param {string} [statusText]
 */
function showError(message, statusText = 'Extraction failed') {
  errorBox.textContent = message;
  errorBox.hidden = false;
  statusEl.textContent = statusText;
}

/**
 * Returns true when the given URL looks like an X/Twitter thread page.
 * Accepted patterns:
 *   https://x.com/<handle>/status/<id>
 *   https://twitter.com/<handle>/status/<id>
 *
 * @param {string} url
 * @returns {boolean}
 */
function isThreadUrl(url) {
  try {
    const u = new URL(url);
    return (
      (u.hostname === 'x.com' || u.hostname === 'twitter.com') &&
      /^\/[^/]+\/status\/\d+/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

// ── Main logic ────────────────────────────────────────────────────────────────

async function runExtraction() {
  statusEl.textContent = 'Extracting thread…';

  // 1. Get the active tab.
  let tab;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = activeTab;
  } catch (e) {
    showError('Could not access the active tab: ' + e.message);
    return;
  }

  if (!tab || !tab.url) {
    showError('No active tab found.');
    return;
  }

  // 2. Validate URL.
  if (!isThreadUrl(tab.url)) {
    showError(
      'Navigate to an X/Twitter thread first.\n\nExpected URL format: x.com/<handle>/status/<id>',
      'Not an X/Twitter thread page'
    );
    return;
  }

  // 3. Set up a one-time message listener BEFORE injecting the script,
  //    so we don't miss a fast response.
  let listenerAttached = false;
  const messagePromise = new Promise((resolve) => {
    function onMessage(message, _sender, _sendResponse) {
      if (message && message.type === 'THREAD_RESULT') {
        chrome.runtime.onMessage.removeListener(onMessage);
        resolve(message.payload);
      }
    }
    chrome.runtime.onMessage.addListener(onMessage);
    listenerAttached = true;
  });

  // 4. Inject content script.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/content.js'],
    });
  } catch (e) {
    // Clean up the dangling listener if injection failed.
    if (listenerAttached) {
      // The promise will never resolve naturally, so show the error immediately.
    }
    showError(
      'Could not inject the extraction script.\n\n' +
      'Make sure the extension has permission to access this page and try refreshing.\n\n' +
      'Detail: ' + e.message
    );
    return;
  }

  // 5. Wait for the content script result, with a generous UI timeout.
  const TIMEOUT_MS = 35000;
  let result;
  try {
    result = await Promise.race([
      messagePromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timed out waiting for thread extraction result.')), TIMEOUT_MS)
      ),
    ]);
  } catch (e) {
    showError(e.message);
    return;
  }

  // 6. Handle result.
  if (!result || !result.ok) {
    const errMsg = (result && result.error) || 'Unknown extraction error.';
    showError(errMsg);
    return;
  }

  // Success path.
  const dateStr = result.date ? new Date(result.date).toISOString().slice(0, 10) : '';
  const header = `Thread by @${result.author} · ${result.tweetCount} tweet${result.tweetCount !== 1 ? 's' : ''}${dateStr ? ' · ' + dateStr : ''}\n${tab.url}\n\n`;
  outputEl.value = header + result.text;
  statusEl.textContent = `Thread by @${result.author} · ${result.tweetCount} tweet${result.tweetCount !== 1 ? 's' : ''}`;
  tweetCount.textContent = `${result.tweetCount} tweet${result.tweetCount !== 1 ? 's' : ''}`;
  btnCopy.disabled = false;
  btnSave.disabled = false;

  if (result.warning) {
    errorBox.textContent = 'Warning: ' + result.warning;
    errorBox.hidden = false;
  }
}

document.addEventListener('DOMContentLoaded', runExtraction);

// ── Clear button ──────────────────────────────────────────────────────────────

btnClear.addEventListener('click', () => {
  outputEl.value = '';
  errorBox.hidden = true;
  errorBox.textContent = '';
  btnCopy.disabled = true;
  btnSave.disabled = true;
  tweetCount.textContent = '';
  statusEl.textContent = 'Cleared.';
});

// ── Save button ───────────────────────────────────────────────────────────────

btnSave.addEventListener('click', async () => {
  const text = outputEl.value;
  if (!text) return;

  // Build filename from author, date and status ID in the current tab URL.
  let filename = 'thread.txt';
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const u = new URL(activeTab.url);
    const parts = u.pathname.split('/').filter(Boolean); // [handle, 'status', id]
    // Extract date from header line in the text: "... · YYYY-MM-DD\n"
    const dateMatch = text.match(/·\s(\d{4}-\d{2}-\d{2})/);
    const datePart = dateMatch ? `_${dateMatch[1]}` : '';
    if (parts.length >= 3) filename = `${parts[0]}${datePart}_${parts[2]}.txt`;
    else if (parts.length >= 1) filename = `${parts[0]}${datePart}_thread.txt`;
  } catch {}

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
});

// ── Copy button ───────────────────────────────────────────────────────────────

btnCopy.addEventListener('click', async () => {
  const text = outputEl.value;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    const original = btnCopy.textContent;
    btnCopy.textContent = 'Copied!';
    setTimeout(() => {
      btnCopy.textContent = 'Copy';
    }, 2000);
  } catch (e) {
    // Fallback: select all text in the textarea so the user can copy manually.
    outputEl.select();
    showError('Clipboard write failed. The thread text is selected — press Ctrl+C to copy.');
  }
});
