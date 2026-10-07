export const CHUNK_SIZE = 64 * 1024; // 64 KB — 4× fewer sends vs 16 KB

const HIGH_WATER_MARK = 8 * 1024 * 1024; // 8 MB (maximum buffered before pausing)
const LOW_WATER_MARK = 1 * 1024 * 1024; // 1 MB (resume when buffered drops to this)

// ─────────────────────────────────────────────────────────────────────────────
// Checksum
// ─────────────────────────────────────────────────────────────────────────────

// Checksum computation removed to prioritize transfer speed.

// ─────────────────────────────────────────────────────────────────────────────
// High-throughput sender
// ─────────────────────────────────────────────────────────────────────────────

const READ_BLOCK_SIZE = 2 * 1024 * 1024; // 2 MB

/**
 * Maximum-throughput file sender with incremental memory reading.
 *
 * @param {File|Blob}       file        Source file.
 * @param {RTCDataChannel}  channel     Open DataChannel (binaryType='arraybuffer').
 * @param {function}        onProgress  Called with 0–99 during send.
 * @param {string}          fileId      Unique transfer ID.
 */
export async function sendFileChunks(file, channel, onProgress, fileId) {
  const actualFileId = fileId || file.name;
  const total = file.size;
  let fileOffset = 0;

  // Set the threshold for the `onbufferedamountlow` event
  channel.bufferedAmountLowThreshold = LOW_WATER_MARK;

  while (fileOffset < total) {
    // Read a 4MB block from the file incrementally to save memory (bumped from 2MB)
    const blockEnd = Math.min(fileOffset + 4 * 1024 * 1024, total);
    const blockBuffer = await file.slice(fileOffset, blockEnd).arrayBuffer();
    const blockLength = blockBuffer.byteLength;
    let blockOffset = 0;

    while (blockOffset < blockLength) {
      // ── Backpressure gate ──────────────────────────────────────────────────
      if (channel.bufferedAmount >= HIGH_WATER_MARK) {
        await new Promise((resolve, reject) => {
          const onLow = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            reject(new Error("Channel closed or errored during transfer."));
          };
          const cleanup = () => {
            channel.removeEventListener('bufferedamountlow', onLow);
            channel.removeEventListener('close', onError);
            channel.removeEventListener('error', onError);
          };
          channel.addEventListener('bufferedamountlow', onLow);
          channel.addEventListener('close', onError);
          channel.addEventListener('error', onError);
          
          // Failsafe in case state changed before event listeners were added
          if (channel.readyState !== 'open') onError();
          else if (channel.bufferedAmount < HIGH_WATER_MARK) onLow();
        });
      }

      // ── Inner pump: fill the buffer greedily ──────────────────────────────
      while (blockOffset < blockLength && channel.bufferedAmount < HIGH_WATER_MARK) {
        const chunkEnd = Math.min(blockOffset + CHUNK_SIZE, blockLength);
        
        try {
          channel.send(blockBuffer.slice(blockOffset, chunkEnd));
          blockOffset = chunkEnd;
        } catch (err) {
          // If the underlying socket buffer is full, send() can throw.
          // Yield to the event loop to let the buffer drain, then retry.
          await new Promise(r => setTimeout(r, 10));
          continue;
        }

        if (onProgress) {
          const overallProgress = fileOffset + blockOffset;
          onProgress(Math.min(99, (overallProgress / total) * 100));
        }
      }
    }
    fileOffset = blockEnd;
  }

  // ── EOF ──────────────────────────────────────────────────────────────────
  channel.send(JSON.stringify({
    type: 'EOF',
    fileId: actualFileId,
    fileName: file.name,
    checksum: null,
  }));
}
