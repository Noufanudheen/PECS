import nodeDataChannel from 'node-datachannel';
import { performance } from 'perf_hooks';

// Turn off verbose logging
// nodeDataChannel.initLogger("Fatal");

const CHUNK_SIZE = 64 * 1024;
const FILE_SIZE = 250 * 1024 * 1024; // 250MB
const HIGH_WATER_MARK = 4 * 1024 * 1024; // 4MB
const LOW_WATER_MARK = 1 * 1024 * 1024; // 1MB

async function runTest() {
  const pc1 = new nodeDataChannel.PeerConnection("Peer1", { iceServers: ["stun:stun.l.google.com:19302"] });
  const pc2 = new nodeDataChannel.PeerConnection("Peer2", { iceServers: ["stun:stun.l.google.com:19302"] });

  pc1.onLocalDescription((sdp, type) => pc2.setRemoteDescription(sdp, type));
  pc2.onLocalDescription((sdp, type) => pc1.setRemoteDescription(sdp, type));
  
  pc1.onLocalCandidate((candidate, mid) => pc2.addRemoteCandidate(candidate, mid));
  pc2.onLocalCandidate((candidate, mid) => pc1.addRemoteCandidate(candidate, mid));

  let receivedBytes = 0;
  let startTime;

  pc2.onDataChannel(dc => {
    dc.onMessage(msg => {
      receivedBytes += msg.length || msg.byteLength;
      if (receivedBytes >= FILE_SIZE) {
        const time = (performance.now() - startTime) / 1000;
        console.log(`Received ${FILE_SIZE} bytes in ${time.toFixed(2)}s. Speed: ${(FILE_SIZE / 1024 / 1024 / time).toFixed(2)} MB/s`);
        process.exit(0);
      }
    });
  });

  const dc1 = pc1.createDataChannel("transfer");
  dc1.setBufferedAmountLowThreshold(LOW_WATER_MARK);

  await new Promise(r => { dc1.onOpen(r); });
  console.log("Channel open, starting transfer...");

  startTime = performance.now();
  const buffer = Buffer.alloc(CHUNK_SIZE);
  let offset = 0;

  try {
    while (offset < FILE_SIZE) {
      if (dc1.bufferedAmount() >= HIGH_WATER_MARK) {
        await new Promise(resolve => {
          dc1.onBufferedAmountLow(() => {
            // We only resolve, don't unset it because node-datachannel might not support unsetting
            resolve();
          });
        });
      }

      while (offset < FILE_SIZE && dc1.bufferedAmount() < HIGH_WATER_MARK) {
        const chunkLength = Math.min(CHUNK_SIZE, FILE_SIZE - offset);
        dc1.sendMessageBinary(buffer.subarray(0, chunkLength));
        offset += chunkLength;
      }
    }
    console.log("Finished sending, waiting for receiver to process...");
  } catch (err) {
    console.error("Transfer failed:", err);
  }
}

runTest().catch(console.error);
