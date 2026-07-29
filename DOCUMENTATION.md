# PECS — Technical Documentation

## Overview

PECS (P2P Ephemeral Continuity Suite) is a browser-native application that lets up to 11 devices on the same network exchange files, chat messages, and clipboard data over a direct WebRTC Mesh Network. A thin signaling server facilitates the initial handshakes only; all application data travels peer-to-peer and is encrypted end-to-end. Nothing is stored on the server.

---

## Architecture (WebRTC Mesh Network)

```
Device A                      Device B                    Device C
   │                              │                           │
   ◄════════ RTCDataChannel ══════►                           │
   │                              │                           │
   ◄════════ RTCDataChannel ══════════════════════════════════►
   │                              │                           │
   │                              ◄════ RTCDataChannel ═══════►
```

All connected peers maintain active WebRTC Data Channels with every other peer in the room. When a user sends a chat message, file, or clipboard item, it is broadcast to all active channels. Once the data channels open, the signaling server is no longer involved in data transfer.

---

## Signaling Server (`server.ts`)

Built with **Express** and **Socket.io**, bound to `0.0.0.0:3000`.

**Events handled:**

| Event | Direction | Behaviour |
|---|---|---|
| `join-room` | client → server | Socket joins the named room; emits `user-joined` to all other sockets in that room |
| `signal` | client → server → target | Relayed strictly to `payload.targetId` with `senderId: socket.id` attached to the envelope |
| `disconnect` | server | Socket removed from all rooms automatically; broadcasts `user-left` to remaining room members |

The `roomId` and `targetId` are carried as unencrypted fields on the outer envelope so the server can route signals without decrypting the payload. The actual SDP/ICE data remains encrypted inside the ciphertext.

In development, Vite middleware is mounted on the same server so both the frontend and the signaling endpoint share port 3000.

---

## Cryptography (`src/lib/crypto.ts`)

### Key Derivation

Uses the Web Crypto API (`window.crypto.subtle`) with PBKDF2:

- **Input**: plaintext room code
- **Salt**: `"ephemeral-clipboard-salt"` (static, hardcoded)
- **Iterations**: 100,000
- **Hash**: SHA-256
- **Output**: 256-bit AES-GCM `CryptoKey`

Both devices independently derive the same key from the same room code. The key never leaves the browser.

### Encryption (`encryptPayload`)

For each outbound signaling payload:
1. Generate a random 12-byte IV via `crypto.getRandomValues`
2. Stringify the payload to JSON
3. Encrypt with AES-GCM using the derived key
4. Return `{ roomId, iv: number[], ciphertext: number[], isFallback: false }`

`roomId` is included in plaintext in the envelope for server routing only.

### Decryption (`decryptPayload`)

Reconstructs `Uint8Array` from the received IV and ciphertext arrays, decrypts with AES-GCM, parses the resulting JSON.

### Non-Secure Context Fallback

`crypto.subtle` requires a secure context (HTTPS or `localhost`). When accessed over a plain HTTP LAN address (e.g. `http://192.168.x.x:3000`), the API is unavailable. Room codes starting with `dev-` or containing `fallback` automatically use an XOR cipher instead:

- XOR each character of the JSON string against the room code, repeated cyclically
- Base64-encode the result
- The envelope uses `{ roomId, iv: [], ciphertextStr: string, isFallback: true }`

This allows cross-origin testing between `localhost` (secure) and a LAN IP (insecure) during development. It is not suitable for production.

---

## WebRTC Handshake (`src/App.tsx`)

### Connection Setup

When a user submits a room code:
1. `deriveKey(roomCode)` is called to produce the shared crypto key
2. A Socket.io socket is created and connects to the server
3. On `connect`: socket emits `join-room` and `setupWebRTC()` is called
4. `setupWebRTC()` creates an `RTCPeerConnection` with two Google STUN servers:
   - `stun:stun.l.google.com:19302`
   - `stun:stun1.l.google.com:19302`

### Offer/Answer Flow

**Initiator (whichever peer was already in the room when the second arrives):**
- Receives `user-joined`
- Creates the `RTCDataChannel` ("fileTransferChannel")
- Calls `createOffer()`, sets local description, encrypts and emits the offer

**Responder:**
- Receives the encrypted offer signal, decrypts it
- Sets remote description, calls `createAnswer()`, sets local description
- Encrypts and emits the answer

**Both peers:**
- Exchange ICE candidates via encrypted signal events
- Candidates arriving before `setRemoteDescription` completes are queued in `pendingCandidatesRef` and flushed immediately after

### Connection State

`RTCPeerConnection.onconnectionstatechange` drives the UI status:
- `connected` → set status `'connected'`
- `disconnected` or `failed` → call `handleDisconnection()`

The data channel `onopen` event also sets status to `'connected'` and starts the heartbeat.

### Stale Connection Protection

Each socket, peer connection, and data channel is captured in a `useRef`. All callbacks check `socket === socketRef.current`, `pc === peerConnectionRef.current`, and `channel === dataChannelRef.current` before acting. This prevents React StrictMode double-mounts and connection retries from allowing stale handlers to corrupt the active session.

---

## Data Channel Protocol (`src/lib/dataChannel.ts`, `src/App.tsx`)

All messages sent over the `RTCDataChannel` are either JSON strings or raw `ArrayBuffer` binary chunks.

### Message Types

| Type | Direction | Fields | Purpose |
|---|---|---|---|
| `HEARTBEAT_PING` | both | `{ type }` | Liveness probe sent every 5 seconds |
| `HEARTBEAT_PONG` | both | `{ type }` | Response to a ping |
| `CHAT_MESSAGE` | both | `{ type, id, text, timestamp }` | Chat message |
| `CLIPBOARD_ITEM` | both | `{ type, item: { id, itemType, content, title, timestamp } }` | Synced text snippet or image snippet |
| `FILE_METADATA` | sender → receiver | `{ type, id, name, size, mimeType }` | Announces incoming file |
| *(ArrayBuffer)* | sender → receiver | raw binary | File chunk data |
| `EOF` | sender → receiver | `{ type, fileId, fileName }` | Signals end of file transfer |

### File Transfer Flow

**Sender:**
1. Sends `FILE_METADATA` JSON
2. Reads the file in 16 KB slices via `FileReader`
3. Sends each slice as a raw `ArrayBuffer`
4. Respects `bufferedAmountLowThreshold` (65536 bytes): pauses and waits for `onbufferedamountlow` if the channel buffer is full
5. After the last chunk, sends `EOF`

**Receiver:**
1. `FILE_METADATA` → initialise OPFS file handle or in-memory buffer; save metadata to IndexedDB
2. Each `ArrayBuffer` → write to OPFS writable stream or append to buffer
3. `EOF` → call `finalizeFile()` then `autoDownloadFile()`:
   - **OPFS path**: closes the writable stream, reads back the file, triggers a browser download
   - **Memory fallback**: concatenates `Uint8Array` chunks into a `Blob`, triggers a browser download

The download is automatic — no user action needed on the receiving side.

---

## Session Clipboard (`src/components/ClipboardPanel.jsx`)

A real-time shared clipboard component for syncing text snippets and pasted images across paired devices during an active session.

- **Manual Paste Button**: Uses `navigator.clipboard.read()` / `readText()` to inspect system clipboard and paste formatted text or images with one click.
- **Global Clipboard Listener**: Captures `paste` events (`Ctrl+V` / `Cmd+V`) anywhere inside the panel.
- **Auto-Copy to System**: When a clipboard item arrives over the network, PECS attempts to automatically copy it to the local operating system clipboard using `navigator.clipboard.write()`. Note: Browsers strictly require the tab to be actively focused to succeed; background auto-copying is blocked by the OS.
- **Text & Image Support**: Supports text strings, code snippets, and pasted images (encoded as Base64 data URLs for instant inline preview).
- **Content Deduplication & Reordering**: If pasted text or image content already exists in session memory, it is moved directly to the top with a refreshed timestamp rather than creating a duplicate entry.
- **20-Item Limit**: Maintains a strict FIFO limit of maximum 20 items per session. Oldest items drop off automatically when new items arrive.
- **One-Click Copy & Save**: Provides one-click "Copy Text" with feedback indicator, and direct "Save Image" download for image snippets.
- **Ephemerality**: All session clipboard state is wiped automatically upon disconnect or session reset.

---

## Heartbeat & Ephemerality (`src/lib/ephemerality.ts`)

### Heartbeat

- Starts when the data channel opens
- Sends `HEARTBEAT_PING` every 5 seconds
- Increments a `missedBeats` counter on each send
- Resets `missedBeats` to 0 on receiving a `HEARTBEAT_PONG`
- If 3 consecutive beats are missed, calls `handleDisconnection()`
- Clears the interval immediately if the channel is no longer open

`startHeartbeat()` attaches `_heartbeatInterval` and `_missedBeats` directly to each `RTCDataChannel` instance, ensuring independent per-channel heartbeat tracking across multi-peer mesh connections without timer collisions.

### Session Wipe (`wipeLocalCache`)

Called on disconnect. Deletes all OPFS entries under the storage root and drops the `ContinuityDB` IndexedDB database. After deletion, posts a `UI_STATE_RESET` message to the window so React can reset all state.

---

## Storage (`src/lib/storage.ts`)

| Function | Description |
|---|---|
| `initializeOPFS(fileName)` | Opens an OPFS file handle for writing; falls back to in-memory buffer if OPFS is unavailable |
| `writeChunkToDisk(chunk)` | Writes an `ArrayBuffer` to the OPFS writable stream or pushes to the memory buffer |
| `finalizeFile()` | Closes the OPFS stream (OPFS path) or triggers in-memory download (fallback path) |
| `autoDownloadFile()` | Reads the completed OPFS file back and triggers a browser download |
| `initializeIndexedDB()` | Opens `ContinuityDB` v1, creates `fileMetadata` object store |
| `saveMetadata(db, obj)` | Persists `{ fileId, name, size }` to IndexedDB |

---

## Chat (`src/components/ChatPanel.tsx`)

A controlled React component. Takes `messages: ChatMessage[]`, an `onSend` callback, and a `disabled` flag.

- Renders message bubbles differentiated by `sender: 'me' | 'peer'`
- Auto-scrolls to the latest message via a `bottomRef`
- Disabled when the data channel is not open (not connected)
- Chat state is cleared on disconnect

Outbound messages are sent as `CHAT_MESSAGE` over the data channel. Inbound `CHAT_MESSAGE` payloads from the peer are appended to state as `sender: 'peer'`.

---

## UI Layout

Header-integrated control bar with a 3-column layout grid:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Header: Logo | Room Code Input / Status & Disconnect | Background Mode (PiP)│
└─────────────────────────────────────────────────────────────────────────────┘
┌─────────────────────┬─────────────────────┬─────────────────────────────────┐
│        Chat         │  Session Clipboard  │          Data Pipeline          │
│ (message history +  │  (manual paste,     │  (file drag-drop, progress bar, │
│  input field)       │   text/img, max 20) │   received badge)               │
└─────────────────────┴─────────────────────┴─────────────────────────────────┘
```

Secure Pairing is integrated directly into the top Header bar. The main dashboard renders three primary workspace columns: Chat, Session Clipboard, and Data Pipeline.

---

## Known Constraints

- **LAN without HTTPS**: `crypto.subtle` is unavailable over plain HTTP on a LAN IP. The XOR fallback is used automatically for room codes starting with `dev-`. For a production deployment behind HTTPS this limitation does not apply.
- **Single file at a time**: The current transfer protocol does not support concurrent file transfers.
- **Mesh Room Limit**: Hard limit of 11 devices per room (up to 8 local LAN + 3 external WAN).
- **No reconnection**: If a peer disconnects (e.g. network drop), the session must be re-established manually by re-entering the room code.
---

## Background Activity & Persistence (`src/lib/backgroundMode.js`)

To prevent web browsers (especially mobile browsers and background desktop tabs) from throttling JavaScript execution, suspending WebSockets, or killing active WebRTC data channels when minimized or backgrounded:

### Picture-in-Picture (PiP) Window

- **Dynamic Canvas Stream**: A hidden `<canvas>` element generates a real-time HUD rendering connection status, room code, and live file transfer progress.
- **Media Stream Video**: The canvas is streamed to a hidden HTML5 `<video>` element using `canvas.captureStream(10)`.
- **Media Engine Keep-Alive**: When user activates **Background Mode**, the video enters Picture-in-Picture (`video.requestPictureInPicture()`). Browsers elevate tab execution priority for active PiP windows, preventing sleep and tab suspension.

### Screen Wake Lock API

- When `isTransferring` is active, the app invokes `navigator.wakeLock.request('screen')` to prevent display sleep and low-power CPU suspend.
- Wake Lock is released automatically when the transfer finishes or fails.

---

## Local Network & Multi-Network Sync Modes

- **Strict LAN Only Mode (Default)**:
  - `iceServers: []` (Zero STUN servers).
  - WebRTC filters out any public reflexive (`srflx`) or relay candidates.
  - Guarantees strict local network isolation: devices **must** be on the same local Wi-Fi or subnet (`192.168.x.x` / `172.x.x.x`). Connections across different networks (e.g. 4G vs Wi-Fi) are automatically blocked.

- **Multi-Network (4G/WAN) Sync Mode**:
  - STUN servers (`stun.l.google.com:19302`) enabled.
  - Allows WebRTC STUN NAT hole-punching for cross-network pairing (e.g., mobile 4G data phone to home Wi-Fi laptop).

- **Zero Server Proxying**: Zero bytes of chat or file transfers pass through the signaling server in either mode. State preference persists in `localStorage`.

---

## Documentation Maintenance

- **Single source of truth** – All design decisions, protocol details, and architectural notes live in `DOCUMENTATION.md`. No inline comments should be added to the source files for future changes.
- **Manual updates** – Whenever you modify a feature (e.g., add a message type, change the handshake flow, or adjust storage logic), edit the corresponding section in `DOCUMENTATION.md` immediately.
- **Commit hygiene** – Include a brief note in the commit message indicating which part of the documentation was updated.

---
244: 
245: ## Deployment

### CI Pipeline (GitHub Actions)

Two workflows live in `.github/workflows/`:

| Workflow | Trigger | Steps |
|---|---|---|
| `ci.yml` | Every push / PR to `main` | `npm ci` → `npm run lint` (type-check) → `npm run build` |
| `deploy.yml` | Push to `main` | HTTP POST to `RENDER_DEPLOY_HOOK_URL` secret |

A broken build will never reach Render because the CI workflow must pass before a deploy is triggered.

### Render Web Service (Production)

The app deploys as a **single Node.js Web Service** on Render — one process that runs `npm start` (`node dist/server.cjs`), which serves both the Socket.io signaling endpoint and the Vite-built static frontend.

**One-time manual setup:**

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect the `Noufanudheen/PECS` GitHub repository
3. Set **Build Command**: `npm install && npm run build`
4. Set **Start Command**: `npm start`
5. Set **Environment**: `Node`
6. Add environment variable `NODE_ENV=production`
7. Go to **Settings → Deploy Hook** → copy the URL
8. Add it to GitHub repo → **Settings → Secrets → Actions** as `RENDER_DEPLOY_HOOK_URL`

The `render.yaml` Blueprint file in the repository documents and can automate steps 2–6 via Render's "New from Blueprint" flow.

### Environment Variables

| Variable | Where set | Purpose |
|---|---|---|
| `PORT` | Injected by Render at runtime | Server listen port (falls back to `3000` locally) |
| `NODE_ENV` | `render.yaml` / Render dashboard | Disables Vite middleware, enables static serving from `dist/` |
| `RENDER_DEPLOY_HOOK_URL` | GitHub Actions Secret | Trigger URL for Render deploys (never committed) |

---

<!-- End of automatically maintained documentation -->

246: 
247: 
