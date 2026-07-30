import { io } from 'socket.io-client';

async function testMeshSignaling() {
  console.log("🚀 Starting Mesh P2P Signaling Server Test...");
  const SERVER_URL = "http://localhost:3000";
  const ROOM = "mesh-autotest-room";

  // Create 4 clients
  const clients = Array.from({ length: 4 }, (_, i) => ({
    id: `C${i + 1}`,
    socket: io(SERVER_URL),
    connected: false,
    offersSent: 0,
    answersReceived: 0,
  }));

  const allConnected = new Promise((resolve) => {
    let connectedCount = 0;
    clients.forEach(c => {
      c.socket.on('connect', () => {
        console.log(`✅ [${c.id}] Connected to server`);
        c.connected = true;
        connectedCount++;
        if (connectedCount === clients.length) resolve();
      });
    });
  });

  await allConnected;
  
  // Staggered joining
  for (let i = 0; i < clients.length; i++) {
    const c = clients[i];
    setTimeout(() => {
      console.log(`\n=> [${c.id}] Joining room...`);
      c.socket.emit('join-room', ROOM);
    }, i * 500); // 500ms delay between joins
  }

  // Setup listeners for mesh handshake
  let totalHandshakes = 0;
  // In a mesh of 4 nodes, total connections = 4 * 3 / 2 = 6 connections.
  // This means 6 offers and 6 answers should be exchanged total.

  const testCompleted = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Test timed out")), 5000);

    clients.forEach(c => {
      c.socket.on('user-joined', (data) => {
        console.log(`📥 [${c.id}] Received 'user-joined' from ${data.peerId}. Sending offer...`);
        c.socket.emit('signal', { 
          roomId: ROOM, 
          targetId: data.peerId, 
          type: 'offer', 
          offer: { sdp: 'mesh-mock-offer' } 
        });
        c.offersSent++;
      });

      c.socket.on('signal', (payload) => {
        if (payload.type === 'offer') {
          console.log(`📥 [${c.id}] Received 'offer' from ${payload.senderId}. Sending answer...`);
          c.socket.emit('signal', { 
            roomId: ROOM, 
            targetId: payload.senderId, 
            type: 'answer', 
            answer: { sdp: 'mesh-mock-answer' } 
          });
        } else if (payload.type === 'answer') {
          console.log(`📥 [${c.id}] Received 'answer' from ${payload.senderId}. Handshake complete!`);
          c.answersReceived++;
          totalHandshakes++;
          
          if (totalHandshakes === 6) { // 6 full connections for 4 peers
            console.log("\n🎉 SUCCESS: All 4 peers successfully formed a 6-connection full mesh network!");
            clearTimeout(timeout);
            resolve();
          }
        }
      });
    });
  });

  try {
    await testCompleted;
  } catch (err) {
    console.error("❌ Test failed:", err.message);
  } finally {
    clients.forEach(c => c.socket.disconnect());
    process.exit(0);
  }
}

testMeshSignaling();
