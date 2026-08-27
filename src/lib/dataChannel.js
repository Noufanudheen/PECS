export const CHUNK_SIZE = 64 * 1024; // 64 KB — 4× fewer sends vs 16 KB

// Must match channel.bufferedAmountLowThreshold set in App.jsx (1 MB).
const HIGH_WATER_MARK = 1048576;

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

  while (fileOffset < total) {
    // Read a 2MB block from the file incrementally to save memory
    const blockEnd = Math.min(fileOffset + READ_BLOCK_SIZE, total);
    const blockBuffer = await file.slice(fileOffset, blockEnd).arrayBuffer();
    const blockLength = blockBuffer.byteLength;
    let blockOffset = 0;

    while (blockOffset < blockLength) {
      // ── Backpressure gate ──────────────────────────────────────────────────
      if (channel.bufferedAmount >= HIGH_WATER_MARK) {
        await new Promise(resolve => {
          channel.onbufferedamountlow = () => {
            channel.onbufferedamountlow = null;
            resolve();
          };
        });
      }

      // ── Inner pump: fill the buffer greedily ──────────────────────────────
      while (blockOffset < blockLength && channel.bufferedAmount < HIGH_WATER_MARK) {
        const chunkEnd = Math.min(blockOffset + CHUNK_SIZE, blockLength);
        channel.send(blockBuffer.slice(blockOffset, chunkEnd));
        blockOffset = chunkEnd;

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
