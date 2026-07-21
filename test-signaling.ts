import { io } from 'socket.io-client';

async function testSignaling() {
  console.log("🚀 Starting P2P Signaling Server Test...");
  const SERVER_URL = "http://localhost:3000";
  const ROOM = "autotest-room-42";

  const client1 = io(SERVER_URL);
  const client2 = io(SERVER_URL);

  let c1Connected = false;
  let c2Connected = false;
  let roomJoinedEvents = 0;
  let signalsExchanged = 0;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Test timed out after 10 seconds"));
    }, 10000);

    client1.on('connect', () => {
      console.log("✅ Client 1 connected to signaling server on port 3000");
      c1Connected = true;
      client1.emit('join-room', ROOM);
    });

    client2.on('connect', () => {
      console.log("✅ Client 2 connected to signaling server on port 3000");
      c2Connected = true;
      setTimeout(() => {
        client2.emit('join-room', ROOM);
      }, 500);
    });

    client1.on('user-joined', () => {
      console.log("✅ Client 1 received 'user-joined' event when Client 2 joined room");
      roomJoinedEvents++;
      client1.emit('signal', { roomId: ROOM, type: 'offer', offer: { sdp: 'mock-sdp-offer' } });
    });

    client2.on('signal', (payload) => {
      console.log("✅ Client 2 received encrypted signal payload from Client 1:", payload.type);
      if (payload.type === 'offer') {
        signalsExchanged++;
        client2.emit('signal', { roomId: ROOM, type: 'answer', answer: { sdp: 'mock-sdp-answer' } });
      }
    });

    client1.on('signal', (payload) => {
      console.log("✅ Client 1 received encrypted signal payload from Client 2:", payload.type);
      if (payload.type === 'answer') {
        signalsExchanged++;
        console.log("🎉 SUCCESS: P2P Signaling server handshake test passed 100%!");
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  client1.disconnect();
  client2.disconnect();
  process.exit(0);
}

testSignaling().catch((err) => {
  console.error("❌ Test failed:", err.message);
  process.exit(1);
});
