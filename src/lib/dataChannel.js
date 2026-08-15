export const CHUNK_SIZE = 16 * 1024;

export function sendFileChunks(file, channel, onProgress, fileId) {
  let offset = 0;
  const actualFileId = fileId || file.name;

  const readSlice = (currentOffset) => {
    const slice = file.slice(currentOffset, currentOffset + CHUNK_SIZE);
    const reader = new FileReader();

    reader.onload = (e) => {
      if (!e.target || !e.target.result) return;
      
      channel.send(e.target.result);
      offset += slice.size;
      
      if (onProgress) {
        const rawProgress = (offset / file.size) * 100;
        onProgress(Math.min(99, rawProgress));
      }

      if (offset < file.size) {
        if (channel.bufferedAmount > channel.bufferedAmountLowThreshold) {
          channel.onbufferedamountlow = () => {
            channel.onbufferedamountlow = null;
            readSlice(offset);
          };
        } else {
          readSlice(offset);
        }
      } else {
        // Send EOF marker with file metadata and fileId
        channel.send(JSON.stringify({ type: 'EOF', fileId: actualFileId, fileName: file.name }));
      }
    };

    reader.readAsArrayBuffer(slice);
  };

  readSlice(0);
}
