import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      console.log(`[Server] Socket ${socket.id} joining room '${roomId}' (current size: ${roomSize})`);
      socket.join(roomId);
      const newRoom = io.sockets.adapter.rooms.get(roomId);
      console.log(`[Server] Room '${roomId}' now has ${newRoom?.size ?? 0} members. Emitting user-joined to others.`);
      socket.to(roomId).emit('user-joined');
    });

    socket.on('signal', (payload) => {
      console.log(`[Server] Relaying signal type='${payload.type ?? payload.ciphertextStr ? 'encrypted' : '?'}' in room '${payload.roomId}'`);
      socket.to(payload.roomId).emit('signal', payload);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Server] Socket disconnected: ${socket.id} (reason: ${reason})`);
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
