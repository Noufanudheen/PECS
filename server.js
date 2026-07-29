import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    console.log(`[Server] Socket connected: ${socket.id}`);

    socket.on('join-room', (roomId) => {
      const room = io.sockets.adapter.rooms.get(roomId);
      const roomSize = room ? room.size : 0;
      
      // Hard limit of 11 devices (8 local + 3 external max)
      if (roomSize >= 11) {
        console.log(`[Server] Room '${roomId}' is full. Rejecting ${socket.id}.`);
        socket.emit('room-full');
        return;
      }
      
      console.log(`[Server] Socket ${socket.id} joining room '${roomId}' (current size: ${roomSize})`);
      socket.join(roomId);
      const newRoom = io.sockets.adapter.rooms.get(roomId);
      console.log(`[Server] Room '${roomId}' now has ${newRoom?.size ?? 0} members. Emitting user-joined to others.`);
      
      // Existing members will initiate the WebRTC offer to the new user
      socket.to(roomId).emit('user-joined', { peerId: socket.id });
    });

    socket.on('signal', (payload) => {
      console.log(`[Server] Relaying signal from ${socket.id} to ${payload.targetId} in room '${payload.roomId}'`);
      // Target specific peer instead of broadcasting
      socket.to(payload.targetId).emit('signal', {
        ...payload,
        senderId: socket.id
      });
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Server] Socket disconnected: ${socket.id} (reason: ${reason})`);
      // Notify others in room so they can clean up the peer connection
      // We broadcast this since socket.rooms is already empty on disconnect
      socket.broadcast.emit('user-left', { peerId: socket.id });
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: { server }
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Static file serving for production
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = parseInt(process.env.PORT ?? "3000", 10);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
