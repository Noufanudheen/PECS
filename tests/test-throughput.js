import wrtc from 'wrtc';
import { performance } from 'perf_hooks';

const { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription } = wrtc;

// Transfer parameters
const CHUNK_SIZE = 64 * 1024;
const FILE_SIZE = 50 * 1024 * 1024; // 50MB
const HIGH_WATER_MARK = 1048576; 
const LOW_WATER_MARK = 1048576; 

async function runTest() {
  const pc1 = new RTCPeerConnection();
  const pc2 = new RTCPeerConnection();

  pc1.onicecandidate = e => { if (e.candidate) pc2.addIceCandidate(e.candidate); };
  pc2.onicecandidate = e => { if (e.candidate) pc1.addIceCandidate(e.candidate); };

  const channel = pc1.createDataChannel('transfer');
  channel.bufferedAmountLowThreshold = LOW_WATER_MARK;

  let receivedBytes = 0;
  let startTime;
  
  pc2.ondatachannel = e => {
    const receiveChannel = e.channel;
    receiveChannel.binaryType = 'arraybuffer';
    receiveChannel.onmessage = msg => {
      receivedBytes += msg.data.byteLength || msg.data.length;
      if (receivedBytes >= FILE_SIZE) {
        const time = (performance.now() - startTime) / 1000;
        console.log(`Received ${FILE_SIZE} bytes in ${time.toFixed(2)}s. Speed: ${(FILE_SIZE / 1024 / 1024 / time).toFixed(2)} MB/s`);
        process.exit(0);
      }
    };
  };

  const offer = await pc1.createOffer();
  await pc1.setLocalDescription(offer);
  await pc2.setRemoteDescription(offer);
  
  const answer = await pc2.createAnswer();
  await pc2.setLocalDescription(answer);
  await pc1.setRemoteDescription(answer);

  await new Promise(r => { channel.onopen = r; });
  console.log("Channel open, starting transfer...");

  startTime = performance.now();
  
  const buffer = Buffer.alloc(CHUNK_SIZE);
  let offset = 0;

  try {
    while (offset < FILE_SIZE) {
      if (channel.bufferedAmount >= HIGH_WATER_MARK) {
        await new Promise(resolve => {
          channel.onbufferedamountlow = () => {
            channel.onbufferedamountlow = null;
            resolve();
          };
        });
      }

      while (offset < FILE_SIZE && channel.bufferedAmount < HIGH_WATER_MARK) {
        const chunkLength = Math.min(CHUNK_SIZE, FILE_SIZE - offset);
        channel.send(buffer.slice(0, chunkLength));
        offset += chunkLength;
      }
    }
    console.log("Finished sending, waiting for receiver...");
  } catch (err) {
    console.error("Transfer failed:", err);
  }
}

runTest().catch(console.error);
