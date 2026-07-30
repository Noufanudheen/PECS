let tempTextArea = document.createElement('textarea');
document.body.appendChild(tempTextArea);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'READ_CLIPBOARD') {
    readClipboardText().then((text) => {
      sendResponse({ text });
    }).catch(err => {
      console.error(err);
      sendResponse({ text: null });
    });
    return true; // Keep message channel open for async response
  }
});

async function readClipboardText() {
  // 1. Try Modern Async API
  if (navigator.clipboard && navigator.clipboard.readText) {
    try {
      const text = await navigator.clipboard.readText();
      if (text) return text;
    } catch (e) {
      // Async read throws DOMException when unfocused; silently proceed to fallback
    }
  }
  
  // 2. Fallback to execCommand
  try {
    tempTextArea.value = '';
    tempTextArea.focus();
    document.execCommand('paste');
    return tempTextArea.value;
  } catch (err) {
    console.warn("Offscreen document failed to read clipboard entirely:", err);
    return null;
  }
}
