# PECS — P2P Ephemeral Continuity Suite

Browser-to-browser file transfer and chat over WebRTC. No accounts, no cloud storage, no data retention.

## How it works

- Devices share a room code to establish a direct WebRTC connection via a lightweight signaling server
- All payloads are AES-GCM encrypted end-to-end; the server never sees plaintext
- Files are streamed in chunks and written to OPFS or memory, then auto-downloaded on the receiving end
- Chat messages travel over the same encrypted data channel

## Stack

- **Frontend** — React, TypeScript, Vite, Tailwind CSS
- **Signaling server** — Node.js, Express, Socket.io
- **P2P transport** — WebRTC (`RTCPeerConnection` + `RTCDataChannel`)
- **Storage** — OPFS (Origin Private File System) with IndexedDB metadata

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` on two devices on the same network. Enter the same room code on both and connect.

> The LAN IP (`http://192.168.x.x:3000`) does not support `crypto.subtle` (non-secure context). The app falls back to an XOR cipher for signaling in that case; use `localhost` or HTTPS for production.

## Project structure

```
src/
  App.tsx                  # Main app, signaling logic, state
  components/
    ChatPanel.tsx          # Chat UI
    DragDropZone.tsx       # File drop target
  lib/
    crypto.ts              # Key derivation, encrypt/decrypt
    dataChannel.ts         # Chunked file sending
    ephemerality.ts        # Heartbeat, session wipe
    storage.ts             # OPFS write, auto-download
server.ts                  # Signaling server (Socket.io)
```

## Notes

- Room codes starting with `dev-` bypass AES-GCM and use the XOR fallback (for LAN testing without HTTPS)
- No data is stored on the server; the signaling server only relays encrypted blobs
- Files are auto-downloaded on the receiving device when the transfer completes
