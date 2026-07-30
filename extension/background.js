// Keep track of the offscreen document and polling state
let isPolling = false;
let pollingIntervalId = null;

console.log("[PECS Extension] Background script loaded.");

// Initialize state on install/startup
chrome.runtime.onInstalled.addListener(() => {
  console.log("[PECS Extension] Extension installed. Setting isEnabled to false.");
  chrome.storage.local.set({ isEnabled: false });
});

async function setupOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  
  if (chrome.runtime.getContexts) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    if (existingContexts.length > 0) return;
  } else {
    const matchedClients = await clients.matchAll();
    for (const client of matchedClients) {
      if (client.url.includes('offscreen.html')) return;
    }
  }

  if (chrome.offscreen) {
    try {
      console.log("[PECS Extension] Creating offscreen document...");
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.CLIPBOARD],
        justification: 'Read clipboard to sync with PECS web app.'
      });
      console.log("[PECS Extension] Offscreen document created.");
    } catch (e) {
      console.warn("[PECS Extension] Offscreen document creation error:", e);
    }
  }
}

async function checkClipboard() {
  const { isEnabled } = await chrome.storage.local.get(['isEnabled']);
  if (!isEnabled) {
    console.log("[PECS Extension] Polling skipped (extension is OFF).");
    return;
  }

  try {
    await setupOffscreenDocument();
    
    // Request the offscreen document to read the clipboard
    chrome.runtime.sendMessage({ type: 'READ_CLIPBOARD' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[PECS Extension] Error sending message to offscreen doc:", chrome.runtime.lastError.message);
        return;
      }
      
      if (response && response.text) {
        processClipboardData(response.text);
      } else {
        console.log("[PECS Extension] Polled clipboard, but it was empty or could not be read.");
      }
    });
  } catch (err) {
    console.error("[PECS Extension] Failed to check clipboard", err);
  }
}

let lastCopiedText = '';

async function processClipboardData(text) {
  if (text && text !== lastCopiedText) {
    console.log(`[PECS Extension] New clipboard text detected! Length: ${text.length}`);
    lastCopiedText = text;
    
    // Broadcast to all active PECS tabs
    const tabs = await chrome.tabs.query({ url: ['*://localhost/*', '*://127.0.0.1/*', '*://*.onrender.com/*'] });
    console.log(`[PECS Extension] Found ${tabs.length} matching tabs to broadcast to.`);
    
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'NEW_CLIPBOARD_TEXT',
        text: text
      }, (resp) => {
        if (chrome.runtime.lastError) {
          console.warn(`[PECS Extension] Could not send to tab ${tab.id}:`, chrome.runtime.lastError.message);
        } else {
          console.log(`[PECS Extension] Successfully sent clipboard data to tab ${tab.id}.`);
        }
      });
    }
  }
}

function startPolling() {
  if (pollingIntervalId) clearInterval(pollingIntervalId);
  console.log("[PECS Extension] Starting clipboard polling (every 2 seconds)...");
  checkClipboard(); // run immediately
  pollingIntervalId = setInterval(checkClipboard, 2000);
}

function stopPolling() {
  if (pollingIntervalId) clearInterval(pollingIntervalId);
  pollingIntervalId = null;
  console.log("[PECS Extension] Stopped clipboard polling.");
  lastCopiedText = ''; 
  if (chrome.offscreen) {
    chrome.offscreen.closeDocument().catch(() => {});
  }
}

// Listen for toggle changes from popup
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.isEnabled) {
    const isEnabled = changes.isEnabled.newValue;
    console.log(`[PECS Extension] Toggle changed. isEnabled = ${isEnabled}`);
    if (isEnabled) {
      startPolling();
    } else {
      stopPolling();
    }
  }
});

// Start polling if enabled on script wake up
chrome.storage.local.get(['isEnabled'], (result) => {
  if (result.isEnabled) {
    startPolling();
  }
});

