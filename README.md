# P2P Ephemeral Clipboard Suite

A browser-native application that enables direct, peer-to-peer data transfer across devices on the same network. The application facilitates the exchange of files, text, and clipboard data over an ephemeral WebRTC mesh network without relying on cloud storage or persistent accounts.

## Core Functions

- **Direct File Transfer**: Stream files directly between devices using WebRTC Data Channels, with chunks written to the Origin Private File System (OPFS) and auto-downloaded upon completion.
- **Session Clipboard**: A synchronized, real-time clipboard that supports text snippets and image data. Maintains a FIFO limit of 20 items.
- **Chat Interface**: Exchange ephemeral text messages within the active session.
- **Secure Pairing**: Devices pair using a shared room code. 

## Under the Hood Features

While the user interface provides standard chat and file drop zones, the application implements several advanced background systems to ensure stability and cross-platform continuity:

- **End-to-End Encryption**: All data transmitted over the WebRTC channel is encrypted using 256-bit AES-GCM. The signaling server handles only the initial handshake and routes encrypted payloads; it never has access to the plaintext data or encryption keys.
- **Mesh Networking & LAN Isolation**: Supports up to 11 concurrent devices. A strict Local Area Network (LAN) mode operates without STUN servers to guarantee absolute network isolation, while an optional WAN mode utilizes NAT hole-punching for cross-network (e.g., 4G to Wi-Fi) connections.
- **Background Execution Persistence**: Prevents mobile and desktop browsers from suspending JavaScript execution when the tab is backgrounded. This is achieved via a Picture-in-Picture (PiP) canvas stream on iOS/Desktop and a silent MediaStreamDestination audio session on Android.
- **Platform-Aware Clipboard Synchronization**:
  - **Desktop**: Features a global document listener for instant pasting and a dedicated browser extension (Manifest V3) that polls the system clipboard via offscreen documents to bypass Service Worker restrictions.
  - **Android**: Uses an active foreground polling loop to automatically detect and broadcast new clipboard items.
  - **iOS**: Queues incoming data silently while the browser is minimized and triggers an OS notification. Returning to the tab (or tapping the notification) automatically flushes the queue via an overlay intervention to comply with Safari's strict user-gesture requirements.
- **Strict Ephemerality**: A 5-second ping/pong heartbeat monitors connection liveness. Upon disconnection, all local cache, IndexedDB metadata, and OPFS storage directories are immediately wiped.

