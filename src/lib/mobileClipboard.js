// Mobile Clipboard Strategy Helper
// Android: attempt background clipboard write directly (Chrome Android allows this with active audio session)
// iOS: queue items silently + show notification, flush to clipboard on app foreground

const isAndroid = () => /Android/i.test(navigator.userAgent);
const isIOS = () => /iPad|iPhone|iPod/i.test(navigator.userAgent);

// Pending queue for iOS deferred clipboard writes
let pendingQueue = [];

/**
 * Handles an incoming clipboard item received over WebRTC.
 * Platform-specific: Android tries background write, iOS queues + notifies.
 * Desktop falls back to the existing hasFocus() pattern (returns false to signal fallback needed).
 * @param {object} item - { itemType: 'text'|'image', content: string }
 * @returns {boolean} true if handled by this function, false if desktop fallback should run
 */
export async function handleIncomingClipboardItem(item) {
  if (isAndroid()) {
    try {
      if (item.itemType === 'text') {
        await navigator.clipboard.writeText(item.content);
        console.log('[MobileClipboard] Android background clipboard write succeeded.');
        return true;
      }
      // Images not supported in background on Android — fall through to queue
    } catch (e) {
      console.warn('[MobileClipboard] Android background write failed (will queue):', e.message);
    }
    // Queue as fallback if write fails
    pendingQueue.push(item);
    return true;
  }

  if (isIOS()) {
    // iOS: always queue and notify
    pendingQueue.push(item);
    _sendNotification(item);
    console.log('[MobileClipboard] iOS: item queued, notification sent. Queue size:', pendingQueue.length);
    return true;
  }

  // Desktop: signal caller to use the existing hasFocus() logic
  return false;
}

/**
 * Flushes the pending clipboard queue when the app returns to foreground.
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
        await navigator.clipboard.writeText(item.content);
        console.log('[MobileClipboard] Flushed text item to clipboard.');
      } else if (item.itemType === 'image') {
        // Attempt image write on return to foreground
        const res = await fetch(item.content);
        const blob = await res.blob();
        let pngBlob = blob;
        if (blob.type !== 'image/png') {
          const bmp = await createImageBitmap(blob);
          const canvas = document.createElement('canvas');
          canvas.width = bmp.width;
          canvas.height = bmp.height;
          canvas.getContext('2d').drawImage(bmp, 0, 0);
          pngBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
        console.log('[MobileClipboard] Flushed image item to clipboard.');
      }
    } catch (e) {
      console.warn('[MobileClipboard] Flush write failed for item:', e.message);
    }
  }
}

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

/**
 * Shows a browser notification for an incoming clipboard item.
 */
function _sendNotification(item) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const body = item.itemType === 'text'
    ? item.content.substring(0, 80) + (item.content.length > 80 ? '...' : '')
    : '📷 Image received — tap to copy';
  new Notification('PECS — New Clipboard Item', {
    body,
    icon: '/assets/icon128.png',
    tag: 'pecs-clipboard', // Replaces previous notification instead of stacking
    renotify: true
  });
}
