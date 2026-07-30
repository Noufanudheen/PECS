// Forward messages from the extension background script to the React app
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'NEW_CLIPBOARD_TEXT') {
    // Send to the window so App.jsx can listen via window.addEventListener('message')
    window.postMessage({
      type: 'EXTENSION_CLIPBOARD_ITEM',
      itemType: 'text',
      content: msg.text,
      timestamp: Date.now()
    }, '*');
    sendResponse({ success: true });
  }
  return true;
});
