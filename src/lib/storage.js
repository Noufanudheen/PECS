// ─── OPFS / memory receive-side state ────────────────────────────────────────
let fileHandle = null;
let writableStream = null;
let inMemoryBuffer = [];
let currentFileName = '';

// ─── Incremental SHA-256 checksum state ──────────────────────────────────────
// We accumulate all received raw chunk bytes so we can hash them at EOF.
// Using a simple array of Uint8Array slices (same as inMemoryBuffer fallback)
// avoids a second pass over the file.
let checksumChunks = [];

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Call this when FILE_METADATA is received.
 * Resets all receive-side state for a fresh transfer.
 */
export async function initializeOPFS(fileName) {
  currentFileName = fileName;
  inMemoryBuffer = [];
  checksumChunks = [];

  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.getDirectory === 'function') {
    try {
      const root = await navigator.storage.getDirectory();
      fileHandle = await root.getFileHandle(fileName, { create: true });
      writableStream = await fileHandle.createWritable();
      return;
    } catch (e) {
      console.warn('[Storage] OPFS initialize failed, using memory fallback', e);
    }
  }

  fileHandle = null;
  writableStream = null;
}

/**
 * Call for every binary ArrayBuffer chunk received on the DataChannel.
 * Writes to OPFS (or memory) AND accumulates the raw bytes for checksum.
 */
export async function writeChunkToDisk(chunk) {
  // Accumulate for checksum verification
  checksumChunks.push(new Uint8Array(chunk instanceof ArrayBuffer ? chunk : chunk.buffer));

  if (writableStream) {
    await writableStream.write(chunk);
  } else {
    inMemoryBuffer.push(new Uint8Array(chunk instanceof ArrayBuffer ? chunk : chunk.buffer));
  }
}

/**
 * Close the writable stream (OPFS) or keep the memory buffer intact.
 * Does NOT trigger download — call autoDownloadFile() after this.
 */
export async function finalizeFile() {
  if (writableStream) {
    await writableStream.close();
    writableStream = null;
  }
  // Memory path: buffer is flushed in autoDownloadFile
}

/**
 * Verify the received bytes against the sender's checksum using SHA-256.
 *
 * @param {string|null} expectedChecksum  Hex string from EOF message (null = skip verify).
 * @returns {{ ok: boolean, actual: string, expected: string }}
 */
export async function verifyChecksum(expectedChecksum) {
  if (!expectedChecksum) {
    return { ok: true, actual: null, expected: null };
  }

  try {
    // Concatenate all received chunks into a single ArrayBuffer
    const totalLength = checksumChunks.reduce((s, c) => s + c.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let pos = 0;
    for (const c of checksumChunks) {
      combined.set(c, pos);
      pos += c.byteLength;
    }

    const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
    const actual = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return { ok: actual === expectedChecksum, actual, expected: expectedChecksum };
  } catch (e) {
    console.warn('[Storage] Checksum verification failed with error', e);
    return { ok: false, actual: null, expected: expectedChecksum };
  }
}

/**
 * Auto-downloads the finalized file from OPFS storage or memory.
 * Call this only after a successful verifyChecksum().
 */
export async function autoDownloadFile() {
  // OPFS path
  if (fileHandle) {
    try {
      const file = await fileHandle.getFile();
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'application/octet-stream' });
      triggerDownload(blob, currentFileName);
      fileHandle = null;
      checksumChunks = [];
      return;
    } catch (e) {
      console.warn('[Storage] Failed to read OPFS file for download', e);
    }
  }

  // Memory path
  if (inMemoryBuffer.length > 0) {
    const blob = new Blob(inMemoryBuffer);
    triggerDownload(blob, currentFileName);
    inMemoryBuffer = [];
    checksumChunks = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ─── IndexedDB helpers (transfer metadata) ───────────────────────────────────

export function initializeIndexedDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB unavailable'));
    }
    const request = indexedDB.open('ContinuityDB', 1);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('fileMetadata')) {
        db.createObjectStore('fileMetadata', { keyPath: 'fileId' });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

export function saveMetadata(db, metadataObj) {
  return new Promise((resolve) => {
    if (!db) return resolve(false);
    try {
      const transaction = db.transaction(['fileMetadata'], 'readwrite');
      const store = transaction.objectStore('fileMetadata');
      const request = store.put(metadataObj);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}
