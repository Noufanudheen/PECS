# PECS — P2P Ephemeral Continuity Suite

Browser-to-browser file transfer, live chat, and automatic system clipboard synchronization over a WebRTC Mesh Network. Zero accounts, zero cloud storage, zero server retention.

---

## ⚡ Key Features

- **Full WebRTC Mesh Network**: Connect up to 11 devices simultaneously across local network (LAN) or multi-network WAN.
- **End-to-End Encryption**: Key derived from room codes using PBKDF2 (SHA-256) + 256-bit AES-GCM.
- **Auto-Clipboard Sync Extension**: Automatically captures OS clipboard changes and syncs them across connected devices.
- **Background Keep-Alive**: Uses Picture-in-Picture (PiP) canvas video streaming and Screen Wake Lock API to prevent mobile/tab suspension during long transfers.
- **Zero-Server Storage**: Files stream in 16 KB chunks directly into OPFS (Origin Private File System) and auto-download on completion.
- **Ephemerality**: Heartbeat monitoring wipes all local caches, IndexedDB metadata, and OPFS entries instantly upon disconnect.

---

## 🧩 Auto-Clipboard Browser Extension

The optional browser extension automatically polls system copy events and pushes them into your PECS Session Clipboard without manual pasting.

### Installation via GitHub Releases

Download the binaries directly from the latest [GitHub Release](https://github.com/Noufanudheen/PECS/releases):

#### 🌐 Google Chrome / Chromium (Brave, Edge, Opera, Vivaldi)
1. Download `extension.crx` from Releases.
2. Open `chrome://extensions/` and enable **Developer mode** (top right).
3. Drag and drop `extension.crx` onto the extensions page.

#### 🦊 Mozilla Firefox
1. Download `extension.xpi` from Releases.
2. Open `about:addons` in Firefox.
3. Click the gear icon ⚙️ and select **Install Add-on From File...**
4. Select `extension.xpi`.

---

## 🚀 Run Locally

```bash
# Install dependencies
npm install

# Start local server + Vite frontend
npm run dev
```

Open `http://localhost:3000` on multiple devices on your network. Enter the same room code on each device to join the mesh!

> **Note**: Plain HTTP LAN URLs (`http://192.168.x.x:3000`) do not support `crypto.subtle` (non-secure context). Room codes starting with `dev-` automatically use an XOR fallback for LAN testing.

---

## 📁 Project Structure

```
extension/                 # Browser Auto-Clipboard Extension (MV3)
  ├── manifest.json        # Dual manifest (Chrome Service Worker + Firefox Event Page)
  ├── background.js        # Environment-aware clipboard polling loop
  └── builds/              # Compiled build artifacts (.crx, .xpi, .pem)
src/
  ├── App.jsx              # WebRTC Mesh state, Socket.io signaling, extension listener
  ├── components/          # React components (Chat, Session Clipboard, Data Pipeline)
  └── lib/                 # Core engine (crypto, WebRTC data channels, OPFS storage, PiP)
server.js                  # Express + Socket.io signaling server
tests/                     # Test scripts and verification tools
```

---

## 🔒 Security & Privacy

- **Zero Server Proxying**: Transferred files and chat payloads never touch or pass through the signaling server.
- **No Data Collection**: The extension and web application store no user telemetry or metrics. All sessions are 100% ephemeral.

