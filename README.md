# PECS (P2P Ephemeral Continuity Suite)

PECS is a browser-native web application that connects devices on the same local network (or via WAN) via a WebRTC mesh network. It allows devices to exchange files, chat messages, and clipboard data directly with each other without routing through a central server. The signaling server is only used for the initial peer discovery and connection handshake.

## Important Functions

- **File Transfer**: Peer-to-peer file transfers using WebRTC Data Channels. Data chunks are written directly to the browser's Origin Private File System (OPFS) and automatically downloaded upon completion.
- **Session Clipboard**: Synchronizes a 20-item FIFO clipboard between connected devices. Supports text snippets and pasted images.
- **Local Chat**: Ephemeral text messaging within the active session.

## Under the Hood Features

- **End-to-End Encryption**: Data transmitted over WebRTC is encrypted via 256-bit AES-GCM. The signaling server routes encrypted payloads but never has access to the plaintext data.
- **Network Isolation (Strict LAN Mode)**: By default, the application runs without STUN/TURN servers (`iceServers: []`), guaranteeing that devices must be on the same local subnet to pair. A Multi-Network mode is available to enable cross-network NAT traversal.
- **Platform-Aware Background Keep-Alive**: Prevents browsers from throttling JavaScript execution when the tab is backgrounded.
  - **Desktop/iOS**: Utilizes a Picture-in-Picture (PiP) canvas stream rendered to a hidden video element with `opacity: 0` and near-zero volume.
  - **Android/iOS Mobile**: Instantiates a silent AudioContext oscillator routed through a `MediaStreamDestination` upon first user interaction to register as an active audio session with the mobile OS, preventing tab suspension.
- **Global Paste Support**: Global DOM listeners capture `Ctrl+V` (or long-press paste on mobile) anywhere on the page to instantly broadcast clipboard data to all peers.
- **Strict Ephemerality**: A 5-second heartbeat ping monitors the connection state. Upon disconnection or session wipe, all OPFS storage directories, local cache, and IndexedDB metadata are immediately and permanently wiped.
