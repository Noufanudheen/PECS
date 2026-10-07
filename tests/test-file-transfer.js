import nodeDataChannel from 'node-datachannel';
import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';

// Turn off verbose logging
// nodeDataChannel.initLogger("Fatal");

const downloadDir = path.resolve(process.env.HOME, "Downloads/Telegram Desktop");
const files = fs.existsSync(downloadDir) ? fs.readdirSync(downloadDir) : [];
const match = files.find(f => f.endsWith("x264.mkv"));
const filePath = match ? path.join(downloadDir, match) : null;

if (!filePath || !fs.existsSync(filePath)) {
  console.error("File not found matching *x264.mkv in:", downloadDir);
  process.exit(1);
}

const CHUNK_SIZE = 64 * 1024;
const FILE_SIZE = fs.statSync(filePath).size;
const HIGH_WATER_MARK = 8 * 1024 * 1024; // 8MB
const LOW_WATER_MARK = 1 * 1024 * 1024; // 1MB

async function runTest() {
  const pc1 = new nodeDataChannel.PeerConnection("Peer1", { iceServers: [] });
  const pc2 = new nodeDataChannel.PeerConnection("Peer2", { iceServers: [] });

  pc1.onLocalDescription((sdp, type) => pc2.setRemoteDescription(sdp, type));
  pc2.onLocalDescription((sdp, type) => pc1.setRemoteDescription(sdp, type));
  
  pc1.onLocalCandidate((candidate, mid) => pc2.addRemoteCandidate(candidate, mid));
  pc2.onLocalCandidate((candidate, mid) => pc1.addRemoteCandidate(candidate, mid));

  let receivedBytes = 0;
  let startTime;
  let lastLogTime = 0;

  pc2.onDataChannel(dc => {
    dc.onMessage(msg => {
      receivedBytes += msg.length || msg.byteLength;
      
      const now = performance.now();
      if (now - lastLogTime > 1000) {
        const timeElapsed = (now - startTime) / 1000;
        console.log(`[Receiver] Progress: ${((receivedBytes / FILE_SIZE) * 100).toFixed(2)}% - Speed: ${(receivedBytes / 1024 / 1024 / timeElapsed).toFixed(2)} MB/s`);
        lastLogTime = now;
      }
      
      if (receivedBytes >= FILE_SIZE) {
        const time = (performance.now() - startTime) / 1000;
        console.log(`\n✅ Finished! Received ${(FILE_SIZE/1024/1024/1024).toFixed(2)} GB in ${time.toFixed(2)}s. Average Speed: ${(FILE_SIZE / 1024 / 1024 / time).toFixed(2)} MB/s`);
        process.exit(0);
      }
    });
  });

  const dc1 = pc1.createDataChannel("transfer");
  dc1.setBufferedAmountLowThreshold(LOW_WATER_MARK);

  await new Promise(r => { dc1.onOpen(r); });
  console.log("Channel open, starting transfer of", (FILE_SIZE/1024/1024/1024).toFixed(2), "GB...");

  startTime = performance.now();
  let offset = 0;
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(CHUNK_SIZE);

  try {
    while (offset < FILE_SIZE) {
      if (dc1.bufferedAmount() >= HIGH_WATER_MARK) {
        await new Promise(resolve => {
          dc1.onBufferedAmountLow(() => {
            resolve();
          });
        });
      }

      while (offset < FILE_SIZE && dc1.bufferedAmount() < HIGH_WATER_MARK) {
        const bytesRead = fs.readSync(fd, buffer, 0, CHUNK_SIZE, offset);
        if (bytesRead === 0) break;
        dc1.sendMessageBinary(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
    }
    fs.closeSync(fd);
    console.log("Finished pushing to buffer, waiting for receiver to process remaining chunks...");
  } catch (err) {
    console.error("Transfer failed:", err);
  }
}

runTest().catch(console.error);
