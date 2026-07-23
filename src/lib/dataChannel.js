export const CHUNK_SIZE = 16 * 1024;

export function sendFileChunks(file, channel, onProgress) {
  let offset = 0;

  const readSlice = (currentOffset) => {
    const slice = file.slice(currentOffset, currentOffset + CHUNK_SIZE);
    const reader = new FileReader();

    reader.onload = (e) => {
      if (!e.target || !e.target.result) return;
      
      channel.send(e.target.result);
      offset += slice.size;
      
      if (onProgress) {
        onProgress((offset / file.size) * 100);
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
        // Send EOF marker with file metadata
        channel.send(JSON.stringify({ type: 'EOF', fileId: file.name, fileName: file.name }));
      }
    };

    reader.readAsArrayBuffer(slice);
  };

  readSlice(0);
}
