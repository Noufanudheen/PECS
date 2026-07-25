import React, { useState, useRef, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import { deriveKey, encryptPayload, decryptPayload } from './lib/crypto';
import { Shield, Key, Zap, Link2, HardDrive, Lock, Tv } from 'lucide-react';
import DragDropZone from './components/DragDropZone';
import ChatPanel from './components/ChatPanel';
import { sendFileChunks } from './lib/dataChannel';
import { initializeOPFS, writeChunkToDisk, finalizeFile, autoDownloadFile, initializeIndexedDB, saveMetadata } from './lib/storage';
import { startHeartbeat, handleHeartbeatMessage, stopHeartbeat, wipeLocalCache } from './lib/ephemerality';
import { updateBackgroundPiPState, togglePictureInPicture, requestWakeLock, releaseWakeLock } from './lib/backgroundMode';

export default function App() {
  const [roomCode, setRoomCode] = useState('');
  const [currentRoom, setCurrentRoom] = useState(null);
  const [status, setStatus] = useState('disconnected');
  
  const [transferProgress, setTransferProgress] = useState(0);
  const [isTransferring, setIsTransferring] = useState(false);
  const [receivedFile, setReceivedFile] = useState(null);

  // Chat state
  const [messages, setMessages] = useState([]);
  const [pipActive, setPipActive] = useState(false);

  const cryptoKeyRef = useRef(null);
  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const dbRef = useRef(null);
  const pendingCandidatesRef = useRef([]);

  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10,
  };

  // Sync state with Picture-in-Picture dynamic stream HUD
  useEffect(() => {
    updateBackgroundPiPState(status, transferProgress, currentRoom, isTransferring);
  }, [status, transferProgress, currentRoom, isTransferring]);

  // Request Screen Wake Lock during active file transfers to prevent OS sleep
  useEffect(() => {
    if (isTransferring) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
  }, [isTransferring]);

  const handleTogglePiP = async () => {
    const active = await togglePictureInPicture();
    setPipActive(active);
  };

  useEffect(() => {
    // Listen for UI reset from ephemerality wipe
    const handleMessage = (e) => {
      if (e.data?.type === 'UI_STATE_RESET') {
        setStatus('disconnected');
        setCurrentRoom(null);
        setTransferProgress(0);
        setIsTransferring(false);
        setReceivedFile(null);
        setMessages([]);
      }
    };
    window.addEventListener('message', handleMessage);

    // Initialize DB
    initializeIndexedDB().then(db => {
      dbRef.current = db;
    }).catch(console.error);

    return () => {
      window.removeEventListener('message', handleMessage);
      socketRef.current?.disconnect();
      peerConnectionRef.current?.close();
      stopHeartbeat();
    };
  }, []);

  const handleDisconnection = useCallback(() => {
    stopHeartbeat();
    peerConnectionRef.current?.close();
    pendingCandidatesRef.current = [];
    wipeLocalCache();
  }, []);

  const addMessage = useCallback((msg) => {
    setMessages(prev => [...prev, msg]);
  }, []);

  const setupDataChannel = useCallback((channel) => {
    dataChannelRef.current = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 65536;

    channel.onopen = () => {
      if (channel !== dataChannelRef.current) return;
      setStatus('connected');
      startHeartbeat(channel, handleDisconnection);
    };

    channel.onclose = () => {
      if (channel !== dataChannelRef.current) return;
      handleDisconnection();
    };

    channel.onmessage = async (event) => {
      if (channel !== dataChannelRef.current) return;
      if (typeof event.data === 'string') {
        const parsed = JSON.parse(event.data);
        if (parsed.type === 'HEARTBEAT_PING' || parsed.type === 'HEARTBEAT_PONG') {
          handleHeartbeatMessage(channel, parsed);
        } else if (parsed.type === 'CHAT_MESSAGE') {
          addMessage({
            id: parsed.id,
            text: parsed.text,
            sender: 'peer',
            timestamp: parsed.timestamp,
          });
        } else if (parsed.type === 'FILE_METADATA') {
          setIsTransferring(true);
          setTransferProgress(0);
          setReceivedFile(null);
          await initializeOPFS(parsed.name);
          if (dbRef.current) {
            await saveMetadata(dbRef.current, { fileId: parsed.id, name: parsed.name, size: parsed.size });
          }
        } else if (parsed.type === 'EOF') {
          await finalizeFile();
          // Auto-download from OPFS if available
          await autoDownloadFile();
          setIsTransferring(false);
          setTransferProgress(100);
          setReceivedFile({ name: parsed.fileName || parsed.fileId, id: parsed.fileId });
        }
      } else if (event.data instanceof ArrayBuffer) {
        await writeChunkToDisk(event.data);
      }
    };
  }, [handleDisconnection, addMessage]);

  const setupWebRTC = async (socket, room) => {
    console.log("⚙️ [WebRTC] Initializing RTCPeerConnection...");
    const pc = new RTCPeerConnection(configuration);
    peerConnectionRef.current = pc;

    pc.ondatachannel = (event) => {
      if (pc !== peerConnectionRef.current) return;
      console.log("📥 [WebRTC] Received remote data channel!");
      setupDataChannel(event.channel);
    };

    pc.onicecandidate = async (event) => {
      if (pc !== peerConnectionRef.current) return;
      if (event.candidate && cryptoKeyRef.current) {
        console.log("gb [Socket.io] Emitting ICE candidate to peer...");
        const encryptedCandidate = await encryptPayload(cryptoKeyRef.current, {
          roomId: room,
          type: 'ice-candidate',
          candidate: event.candidate
        });
        socket.emit('signal', encryptedCandidate);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc !== peerConnectionRef.current) return;
      console.log(`⚙️ [WebRTC] Connection state changed to: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        setStatus('connected');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        handleDisconnection();
      }
    };
    setStatus('waiting');
  };

  const handleJoin = async (e, overrideRoomCode) => {
    if (e) e.preventDefault();
    const activeRoom = overrideRoomCode || roomCode;
    if (!activeRoom.trim()) return;
    
    // Clean up any existing connection first
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    pendingCandidatesRef.current = [];
    
    setStatus('connecting');
    
    try {
      cryptoKeyRef.current = await deriveKey(activeRoom);
      setCurrentRoom(activeRoom);

      const socket = io();
      socketRef.current = socket;

      socket.on('connect', () => {
        if (socket !== socketRef.current) return;
        console.log(`🟢 [Socket.io] Connected successfully. Joining room: ${activeRoom}`);
        socket.emit('join-room', activeRoom);
        setupWebRTC(socket, activeRoom);
      });

      socket.on('connect_error', (err) => {
        console.error("❌ [Socket.io] Connection error:", err.message, err);
      });

      socket.on('user-joined', async () => {
        if (socket !== socketRef.current) return;
        console.log("📥 [Socket.io] Received 'user-joined' event from peer. Initiating WebRTC...");
        if (!cryptoKeyRef.current || !peerConnectionRef.current) {
          console.warn("⚠️ [Socket.io] user-joined received but cryptoKey or peerConnection is null!");
          return;
        }
        
        try {
          const pc = peerConnectionRef.current;
          
          // Initiator creates the data channel
          console.log("⚙️ [WebRTC] Creating data channel 'fileTransferChannel'...");
          const dc = pc.createDataChannel("fileTransferChannel");
          setupDataChannel(dc);

          console.log("⚙️ [WebRTC] Creating local SDP offer...");
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          
          console.log("📤 [Socket.io] Encrypting and sending SDP offer...");
          const encryptedOffer = await encryptPayload(cryptoKeyRef.current, {
            roomId: activeRoom,
            type: 'offer',
            offer
          });
          socket.emit('signal', encryptedOffer);
        } catch (error) {
          console.error("❌ [WebRTC] Failed to create offer on user join", error);
        }
      });

      socket.on('signal', async (encryptedPayload) => {
        if (socket !== socketRef.current) return;
        if (!cryptoKeyRef.current || !peerConnectionRef.current) {
          console.warn("⚠️ [Socket.io] signal received but cryptoKey or peerConnection is null!");
          return;
        }
        
        try {
          const payload = await decryptPayload(cryptoKeyRef.current, encryptedPayload);
          console.log(`📥 [Socket.io] Decrypted signal: type = ${payload.type}`);
          const pc = peerConnectionRef.current;

          if (payload.type === 'offer') {
            console.log("⚙️ [WebRTC] Setting remote SDP offer...");
            await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
            // Flush any queued candidates
            console.log(`⚙️ [WebRTC] Processing ${pendingCandidatesRef.current.length} queued ICE candidates...`);
            for (const candidate of pendingCandidatesRef.current) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {
                console.error("❌ [WebRTC] Error adding queued ice candidate", e);
              }
            }
            pendingCandidatesRef.current = [];

            console.log("⚙️ [WebRTC] Creating local SDP answer...");
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            console.log("📤 [Socket.io] Encrypting and sending SDP answer...");
            const encryptedAnswer = await encryptPayload(cryptoKeyRef.current, {
              roomId: activeRoom,
              type: 'answer',
              answer
            });
            socket.emit('signal', encryptedAnswer);
          } else if (payload.type === 'answer') {
            console.log("⚙️ [WebRTC] Setting remote SDP answer...");
            await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
            // Flush any queued candidates
            console.log(`⚙️ [WebRTC] Processing ${pendingCandidatesRef.current.length} queued ICE candidates...`);
            for (const candidate of pendingCandidatesRef.current) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {
                console.error("❌ [WebRTC] Error adding queued ice candidate", e);
              }
            }
            pendingCandidatesRef.current = [];
          } else if (payload.type === 'ice-candidate') {
            if (pc.remoteDescription) {
              console.log("⚙️ [WebRTC] Adding ICE candidate directly...");
              await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } else {
              console.log("⚙️ [WebRTC] Queueing ICE candidate (remoteDescription is null)...");
              pendingCandidatesRef.current.push(payload.candidate);
            }
          }
        } catch (error) {
          console.error("❌ [Socket.io] Failed to decrypt or process signal", error);
        }
      });

    } catch (err) {
      console.error("Failed to initialize connection", err);
      setStatus('disconnected');
    }
  };

  // ==========================================
  // TEST AUTOMATION CODE
  // ==========================================
  useEffect(() => {
    let active = true;
    const delay = 500 + Math.random() * 1000;
    const timer = setTimeout(async () => {
      if (!active) return;
      const defaultRoom = "dev-p2p-room";
      setRoomCode(defaultRoom);
      console.log(`🚀 [AutoTest] Automatically joining room: ${defaultRoom} (delay: ${delay.toFixed(0)}ms)`);
      handleJoin(undefined, defaultRoom);
    }, delay);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  // ==========================================
  // END TEST AUTOMATION CODE
  // ==========================================

  const handleFileSelect = (file) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') return;
    
    setIsTransferring(true);
    setTransferProgress(0);

    const uuid = typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : Math.random().toString(36).substring(2) + Date.now().toString(36);

    dataChannelRef.current.send(JSON.stringify({
      type: 'FILE_METADATA',
      id: uuid,
      name: file.name,
      size: file.size,
      mimeType: file.type
    }));

    sendFileChunks(file, dataChannelRef.current, (progress) => {
      setTransferProgress(progress);
      if (progress >= 100) {
        setIsTransferring(false);
      }
    });
  };

  const handleSendChat = useCallback((text) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const msg = { id, text, sender: 'me', timestamp: Date.now() };
    addMessage(msg);
    dataChannelRef.current.send(JSON.stringify({
      type: 'CHAT_MESSAGE',
      id,
      text,
      timestamp: msg.timestamp,
    }));
  }, [addMessage]);

  const statusBadge = {
    connected: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    waiting:   'bg-amber-500/10  text-amber-400  border-amber-500/20',
    connecting:'bg-sky-500/10    text-sky-400    border-sky-500/20',
    disconnected:'bg-zinc-500/10 text-zinc-400   border-zinc-700/30',
  }[status];

  const statusDot = {
    connected:   'bg-emerald-400',
    waiting:     'bg-amber-400 animate-pulse',
    connecting:  'bg-sky-400 animate-pulse',
    disconnected:'bg-zinc-600',
  }[status];

  const statusLabel = {
    connected:   'Connected',
    waiting:     'Waiting for Peer',
    connecting:  'Connecting…',
    disconnected:'Disconnected',
  }[status];

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-zinc-200 font-sans selection:bg-indigo-500/30">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-10">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-xl font-medium tracking-tight text-white">Ephemeral Suite</h1>
              <p className="text-xs text-zinc-500 font-mono">P2P Continuity &amp; Clipboard</p>
            </div>
          </div>

          {/* Global status & PiP control badge */}
          <div className="flex items-center space-x-3">
            {status !== 'disconnected' && (
              <div className={`px-3 py-1 rounded-full text-xs font-medium border flex items-center space-x-2 ${statusBadge}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
                <span>{statusLabel}</span>
                {currentRoom && <span className="font-mono opacity-60">· {currentRoom}</span>}
              </div>
            )}

            <button
              onClick={handleTogglePiP}
              title="Pop out Picture-in-Picture window to keep P2P transfer active in background when tab is hidden"
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all flex items-center space-x-1.5 ${
                pipActive
                  ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-lg shadow-indigo-500/10'
                  : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border-zinc-800'
              }`}
            >
              <Tv className="w-3.5 h-3.5" />
              <span>{pipActive ? 'PiP Active' : 'Background Mode'}</span>
            </button>
          </div>
        </header>

        {/* 3-column layout */}
        <main className="grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] gap-6 items-start">

          {/* ── LEFT: Secure Pairing ── */}
          <section>
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6 backdrop-blur-sm">
              <h2 className="text-lg font-medium text-white mb-2 flex items-center">
                <Link2 className="w-4 h-4 mr-2 text-zinc-400" />
                Secure Pairing
              </h2>
              <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
                Enter a shared room code to establish an end-to-end encrypted WebRTC tunnel. Data never persists on our servers.
              </p>

              {status === 'disconnected' ? (
                <form onSubmit={handleJoin} className="space-y-4">
                  <div>
                    <label htmlFor="roomCode" className="block text-xs font-mono text-zinc-500 mb-2 uppercase tracking-wider">
                      Room Code
                    </label>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input
                        id="roomCode"
                        type="text"
                        value={roomCode}
                        onChange={(e) => setRoomCode(e.target.value)}
                        placeholder="e.g. gamma-ray-burst"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 pl-10 pr-4 text-white placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all font-mono text-sm"
                        required
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-3 px-4 font-medium transition-colors shadow-lg shadow-indigo-500/10"
                  >
                    Initialize Connection
                  </button>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                    <p className="text-xs font-mono text-zinc-500 mb-1">CURRENT ROOM</p>
                    <p className="text-white font-mono text-sm">{currentRoom}</p>
                  </div>
                  <button
                    onClick={() => {
                      handleDisconnection();
                      setStatus('disconnected');
                      setCurrentRoom(null);
                      setMessages([]);
                      setReceivedFile(null);
                      setIsTransferring(false);
                    }}
                    className="w-full bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl py-3 px-4 font-medium transition-colors border border-zinc-700"
                  >
                    Disconnect &amp; Wipe
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* ── CENTER: Chat ── */}
          <section>
            <div
              className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6 backdrop-blur-sm flex flex-col"
              style={{ height: 520 }}
            >
              <ChatPanel
                messages={messages}
                onSend={handleSendChat}
                disabled={status !== 'connected'}
              />
            </div>
          </section>

          {/* ── RIGHT: Data Pipeline ── */}
          <section>
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6 backdrop-blur-sm flex flex-col" style={{ minHeight: 520 }}>
              <h2 className="text-lg font-medium text-white mb-2 flex items-center">
                <Shield className="w-4 h-4 mr-2 text-zinc-400" />
                Data Pipeline
              </h2>
              
              {status === 'connected' ? (
                <div className="flex-1 flex flex-col mt-4 space-y-4">
                  <DragDropZone 
                    onFileSelect={handleFileSelect} 
                    disabled={isTransferring} 
                  />
                  
                  {isTransferring && (
                    <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                      <div className="flex justify-between text-xs text-zinc-400 mb-2">
                        <span>Transferring…</span>
                        <span>{Math.round(transferProgress)}%</span>
                      </div>
                      <div className="w-full bg-zinc-800 rounded-full h-1.5">
                        <div 
                          className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${transferProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {receivedFile && !isTransferring && (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-center space-x-3 text-emerald-400 text-sm">
                      <HardDrive className="w-5 h-5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium">File received &amp; saved</p>
                        <p className="text-emerald-400/70 text-xs truncate mt-0.5">{receivedFile.name}</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col justify-center items-center text-center p-6 border border-dashed border-zinc-800 rounded-xl mt-4">
                  <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-4">
                    <Lock className="w-6 h-6 text-zinc-500" />
                  </div>
                  <h3 className="text-zinc-400 font-medium mb-2">Tunnel Inactive</h3>
                  <p className="text-sm text-zinc-600 max-w-[200px]">
                    Awaiting WebRTC handshake to establish secure P2P layer.
                  </p>
                </div>
              )}
            </div>
          </section>

        </main>
      </div>
    </div>
  );
}
