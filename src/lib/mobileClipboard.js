// Mobile Clipboard Strategy Helper
// Android foreground: poll readText() every 2s → detect new copy → broadcast to peers
// Android (receiving from peer): write to clipboard via execCommand fallback (works without user gesture)
// Android background (audio alive): attempt write, queue as fallback
// iOS: queue items silently + notifications, flush on foreground return

export const isAndroid = () => /Android/i.test(navigator.userAgent);
export const isIOS = () => /iPad|iPhone|iPod/i.test(navigator.userAgent);

// Pending queue for deferred clipboard writes (iOS + Android bg fallback)
let pendingQueue = [];

// Foreground poller state
let pollerIntervalId = null;
let lastPolledText = '';

// ─────────────────────────────────────────────────
// WRITING TO CLIPBOARD (receiving from peer)
// ─────────────────────────────────────────────────

/**
 * Tries to write text to Android clipboard.
 * Strategy:
 *   1. navigator.clipboard.writeText() — works in foreground on modern Chrome Android
 *   2. execCommand('copy') on a focused textarea — works even without user gesture on Android
 * Returns true if write succeeded.
 */
async function writeToAndroidClipboard(text) {
  // Attempt 1: Modern Clipboard API
  try {
    await navigator.clipboard.writeText(text);
    console.log('[MobileClipboard] Android: writeText() succeeded.');
    return true;
  } catch (e) {
    console.warn('[MobileClipboard] Android: writeText() failed, trying execCommand:', e.message);
  }

  // Attempt 2: execCommand('copy') via hidden textarea (no user gesture needed on most Android Chrome)
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const success = document.execCommand('copy');
    document.body.removeChild(ta);
    if (success) {
      console.log('[MobileClipboard] Android: execCommand copy succeeded.');
      return true;
    }
  } catch (e) {
    console.warn('[MobileClipboard] Android: execCommand copy failed:', e.message);
  }

  return false;
}

/**
 * Handles an incoming clipboard item received over WebRTC.
 * Platform-specific routing.
 * Returns true if handled by mobile logic, false to signal desktop fallback.
 */
export async function handleIncomingClipboardItem(item) {
  if (isAndroid()) {
    if (item.itemType === 'text') {
      const wrote = await writeToAndroidClipboard(item.content);
      if (!wrote) {
        // Queue for next time document regains focus
        pendingQueue.push(item);
        console.log('[MobileClipboard] Android: queued item for deferred write.');
      }
    }
    // Images: queue for foreground flush (execCommand can't write images)
    else {
      pendingQueue.push(item);
    }
    return true;
  }

  if (isIOS()) {
    pendingQueue.push(item);
    _sendNotification(item);
    console.log('[MobileClipboard] iOS: item queued, notification sent. Queue size:', pendingQueue.length);
    return true;
  }

  // Desktop: signal caller to run hasFocus() logic
  return false;
}

// ─────────────────────────────────────────────────
// FOREGROUND POLLER (Android: detect new copy → broadcast)
// ─────────────────────────────────────────────────

/**
 * Starts polling the system clipboard every 2s while the tab is visible.
 * When new text is detected, calls onNewText(text) to broadcast to peers.
 * Android only — iOS blocks readText() entirely.
 * @param {function} onNewText - callback receives the new text string
 */
export function startForegroundPoller(onNewText) {
  if (!isAndroid()) return;
  if (pollerIntervalId) return; // Already running

  console.log('[MobileClipboard] Android: Starting foreground clipboard poller.');

  const poll = async () => {
    if (document.hidden) return; // Only poll when tab is visible
    try {
      const text = await navigator.clipboard.readText();
      if (text && text !== lastPolledText) {
        lastPolledText = text;
        console.log('[MobileClipboard] Android: New clipboard text detected, broadcasting.');
        onNewText(text);
      }
    } catch (e) {
      // readText() needs focus — silently ignore when tab loses focus
    }
  };

  poll(); // Run immediately on start
  pollerIntervalId = setInterval(poll, 2000);
}

/**
 * Stops the foreground clipboard poller.
 */
export function stopForegroundPoller() {
  if (pollerIntervalId) {
    clearInterval(pollerIntervalId);
    pollerIntervalId = null;
    lastPolledText = '';
    console.log('[MobileClipboard] Android: Foreground clipboard poller stopped.');
  }
}

// ─────────────────────────────────────────────────
// QUEUE FLUSH (iOS & Android bg fallback)
// ─────────────────────────────────────────────────

/**
 * Flushes the pending clipboard queue on return to foreground.
 * Called on visibilitychange to 'visible'.
 */
export async function flushPendingQueue() {
  if (!pendingQueue.length) return;
  const queue = [...pendingQueue];
  pendingQueue = [];
  console.log(`[MobileClipboard] Flushing ${queue.length} queued item(s) to clipboard.`);

  for (const item of queue) {
    try {
      if (item.itemType === 'text') {
        const wrote = isAndroid()
          ? await writeToAndroidClipboard(item.content)
          : await navigator.clipboard.writeText(item.content).then(() => true).catch(() => false);
        if (!wrote) console.warn('[MobileClipboard] Flush: could not write item.');
      } else if (item.itemType === 'image') {
        const res = await fetch(item.content);
        const blob = await res.blob();
        let pngBlob = blob;
        if (blob.type !== 'image/png') {
          const bmp = await createImageBitmap(blob);
          const canvas = document.createElement('canvas');
          canvas.width = bmp.width; canvas.height = bmp.height;
          canvas.getContext('2d').drawImage(bmp, 0, 0);
          pngBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      }
    } catch (e) {
      console.warn('[MobileClipboard] Flush write failed:', e.message);
    }
  }
}

// ─────────────────────────────────────────────────
// NOTIFICATION
// ─────────────────────────────────────────────────

/**
 * Requests Notification permission. Call when Background Mode is enabled.
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    console.log('[MobileClipboard] Notification permission:', result);
  }
}

function _sendNotification(item) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const body = item.itemType === 'text'
    ? item.content.substring(0, 80) + (item.content.length > 80 ? '...' : '')
    : '📷 Image received — tap to copy';
  new Notification('PECS — New Clipboard Item', {
    body,
    icon: '/assets/icon128.png',
    tag: 'pecs-clipboard',
    renotify: true
  });
}

