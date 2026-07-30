const toggle = document.getElementById('sync-toggle');
const statusText = document.getElementById('status-text');

// Initialize state
chrome.storage.local.get(['isEnabled'], (result) => {
  const isEnabled = result.isEnabled || false;
  toggle.checked = isEnabled;
  updateStatusText(isEnabled);
});

toggle.addEventListener('change', (e) => {
  const isEnabled = e.target.checked;
  chrome.storage.local.set({ isEnabled });
  updateStatusText(isEnabled);
});

function updateStatusText(isEnabled) {
  if (isEnabled) {
    statusText.textContent = 'Sync is ON';
    statusText.style.color = '#34d399'; // Emerald 400
  } else {
    statusText.textContent = 'Sync is OFF';
    statusText.style.color = '#e4e4e7'; // Zinc 200
  }
}
