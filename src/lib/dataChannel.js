export const CHUNK_SIZE = 16 * 1024; // 16 KB per chunk

// How many chunks to queue ahead before checking backpressure.
// At 16 KB each, 64 chunks = 1 MB of pre-queued data in flight.
const BATCH_SIZE = 64;

/**
 * Compute a SHA-256 hex digest of a File/Blob using the Web Crypto API.
 * Returned as a lowercase hex string.
 */
export async function computeFileChecksum(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * High-throughput file sender.
 *
 * Strategy:
 *  - Batches up to BATCH_SIZE chunks before yielding to the backpressure guard.
 *  - Only pauses when bufferedAmount > bufferedAmountLowThreshold (1 MB).
 *  - Uses FileReader slices so we never load the whole file into memory.
 *  - Sends an EOF message with the pre-computed SHA-256 checksum so receivers
 *    can verify integrity before saving.
 *
 * @param {File}     file        File to send.
 * @param {RTCDataChannel} channel  Open DataChannel.
 * @param {function} onProgress  Called with 0–99 during send.
 * @param {string}   fileId      Unique transfer ID.
 * @param {string}   checksum    Pre-computed SHA-256 hex of the file (from computeFileChecksum).
 */
export function sendFileChunks(file, channel, onProgress, fileId, checksum) {
  let offset = 0;
  let chunksInBatch = 0;
  const actualFileId = fileId || file.name;

  const sendNextChunk = () => {
    if (offset >= file.size) {
      // All chunks sent — emit EOF with checksum
      channel.send(JSON.stringify({
        type: 'EOF',
        fileId: actualFileId,
        fileName: file.name,
        checksum: checksum || null,
      }));
      return;
    }

    // Backpressure gate — pause if the send buffer is full
    if (channel.bufferedAmount > channel.bufferedAmountLowThreshold) {
      channel.onbufferedamountlow = () => {
        channel.onbufferedamountlow = null;
        chunksInBatch = 0;
        sendNextChunk();
      };
      return;
    }

    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const reader = new FileReader();

    reader.onload = (e) => {
      if (!e.target?.result) return;

      channel.send(e.target.result);
      offset += slice.size;
      chunksInBatch++;

      if (onProgress) {
        onProgress(Math.min(99, (offset / file.size) * 100));
      }

      if (offset >= file.size) {
        // Done — send EOF
        channel.send(JSON.stringify({
          type: 'EOF',
          fileId: actualFileId,
          fileName: file.name,
          checksum: checksum || null,
        }));
        return;
      }

      // Yield to backpressure guard every BATCH_SIZE chunks
      if (chunksInBatch >= BATCH_SIZE) {
        chunksInBatch = 0;
        if (channel.bufferedAmount > channel.bufferedAmountLowThreshold) {
          channel.onbufferedamountlow = () => {
            channel.onbufferedamountlow = null;
            sendNextChunk();
          };
        } else {
          // Use a microtask-yield to keep the event loop responsive
          queueMicrotask(sendNextChunk);
        }
      } else {
        sendNextChunk();
      }
    };

    reader.readAsArrayBuffer(slice);
  };

  sendNextChunk();
}
