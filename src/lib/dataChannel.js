export const CHUNK_SIZE = 64 * 1024; // 64 KB — 4× fewer sends vs 16 KB

// Must match channel.bufferedAmountLowThreshold set in App.jsx (1 MB).
const HIGH_WATER_MARK = 1048576;

// ─────────────────────────────────────────────────────────────────────────────
// Checksum
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SHA-256 a pre-loaded ArrayBuffer. Returns a lowercase hex string.
 * Accepts either an ArrayBuffer (fast path) or a File/Blob.
 */
export async function computeFileChecksum(fileOrBuffer) {
  const buf =
    fileOrBuffer instanceof ArrayBuffer
      ? fileOrBuffer
      : await fileOrBuffer.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// High-throughput sender
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maximum-throughput file sender.
 *
 * Key decisions:
 *  1. Read the whole file into an ArrayBuffer once — no per-chunk FileReader.
 *  2. Inner while-loop: keep pumping 64 KB slices as long as the DataChannel
 *     send buffer has room (< HIGH_WATER_MARK). ArrayBuffer.slice() is O(1).
 *  3. Outer await: only suspend when the buffer is truly full, resuming via
 *     the bufferedamountlow event (no polling, no setTimeout).
 *  4. Checksum is accepted externally so the caller can compute it from the
 *     same pre-loaded buffer — zero duplicate file reads.
 *
 * @param {File|Blob}       file        Source file.
 * @param {RTCDataChannel}  channel     Open DataChannel (binaryType='arraybuffer').
 * @param {function}        onProgress  Called with 0–99 during send.
 * @param {string}          fileId      Unique transfer ID.
 * @param {string|null}     checksum    Pre-computed SHA-256 hex (or null).
 */
export async function sendFileChunks(file, channel, onProgress, fileId, checksum) {
  const actualFileId = fileId || file.name;

  // Single read — all subsequent work is synchronous buffer slicing
  const buffer = await file.arrayBuffer();
  const total = buffer.byteLength;
  let offset = 0;

  while (offset < total) {
    // ── Backpressure gate ──────────────────────────────────────────────────
    // If the channel's send queue is at or above the high-water mark, park
    // here until the browser fires bufferedamountlow (threshold = 1 MB).
    if (channel.bufferedAmount >= HIGH_WATER_MARK) {
      await new Promise(resolve => {
        channel.onbufferedamountlow = () => {
          channel.onbufferedamountlow = null;
          resolve();
        };
      });
    }

    // ── Inner pump: fill the buffer greedily ──────────────────────────────
    // Keep sending until the queue is full again. Each `.slice()` is O(1)
    // (no data copy — returns a new ArrayBuffer view into the same memory).
    while (offset < total && channel.bufferedAmount < HIGH_WATER_MARK) {
      const end = Math.min(offset + CHUNK_SIZE, total);
      channel.send(buffer.slice(offset, end));
      offset = end;

      if (onProgress) {
        onProgress(Math.min(99, (offset / total) * 100));
      }
    }
  }

  // ── EOF ──────────────────────────────────────────────────────────────────
  channel.send(JSON.stringify({
    type: 'EOF',
    fileId: actualFileId,
    fileName: file.name,
    checksum: checksum ?? null,
  }));
}
