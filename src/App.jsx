import React, { useState, useRef, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import { deriveKey, encryptPayload, decryptPayload } from './lib/crypto';
import { Shield, Key, Zap, Link2, HardDrive, Lock, Tv, Wifi, Globe } from 'lucide-react';
import DragDropZone from './components/DragDropZone';
import ChatPanel from './components/ChatPanel';
import ClipboardPanel from './components/ClipboardPanel';
import { sendFileChunks } from './lib/dataChannel';
import { initializeOPFS, writeChunkToDisk, finalizeFile, autoDownloadFile, initializeIndexedDB, saveMetadata } from './lib/storage';
import { startHeartbeat, handleHeartbeatMessage, stopHeartbeat, wipeLocalCache } from './lib/ephemerality';
import { updateBackgroundPiPState, togglePictureInPicture, requestWakeLock, releaseWakeLock, setupBackgroundKeepAlive, initMobileBackgroundSound } from './lib/backgroundMode';
import { handleIncomingClipboardItem, flushPendingQueue, requestNotificationPermission, startForegroundPoller, stopForegroundPoller, isAndroid } from './lib/mobileClipboard';

export default function App() {
  const [roomCode, setRoomCode] = useState('');
  const [currentRoom, setCurrentRoom] = useState(null);
  const [status, setStatus] = useState('disconnected');
  
  const [transferProgress, setTransferProgress] = useState(0);
  const [isTransferring, setIsTransferring] = useState(false);
  const [receivedFile, setReceivedFile] = useState(null);

  // Chat, Clipboard & Network Sync state
  const [messages, setMessages] = useState([]);
  const [clipboardItems, setClipboardItems] = useState([]);
  const [pipActive, setPipActive] = useState(false);
  const [showIosSyncOverlay, setShowIosSyncOverlay] = useState(false);
  const [allowMultiNetwork, setAllowMultiNetwork] = useState(() => {
    return localStorage.getItem('pecs_allow_multi_network') === 'true';
  });

  const allowMultiNetworkRef = useRef(allowMultiNetwork);
  useEffect(() => {
    allowMultiNetworkRef.current = allowMultiNetwork;
    localStorage.setItem('pecs_allow_multi_network', String(allowMultiNetwork));
  }, [allowMultiNetwork]);

  const kickExternalPeers = async () => {
    console.log("🔒 [WebRTC] Strict LAN Mode enabled. Checking for external connections to kick...");
    for (const [peerId, pc] of peersRef.current.entries()) {
      try {
        const stats = await pc.getStats();
        let isExternal = false;
        stats.forEach(report => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            const local = stats.get(report.localCandidateId);
            const remote = stats.get(report.remoteCandidateId);
            if (local && (local.candidateType === 'srflx' || local.candidateType === 'relay')) isExternal = true;
            if (remote && (remote.candidateType === 'srflx' || remote.candidateType === 'relay')) isExternal = true;
          }
        });
        if (isExternal) {
          console.log(`🔒 [WebRTC] Kicking peer ${peerId} (Active connection is not local).`);
          handleDisconnection(peerId);
        }
      } catch (e) {
        console.warn("Error checking stats for peer", e);
      }
    }
  };

  const handleToggleMultiNetwork = () => {
    setAllowMultiNetwork(prev => {
      const next = !prev;
      if (!next) kickExternalPeers();
      return next;
    });
  };

  const cryptoKeyRef = useRef(null);
  const socketRef = useRef(null);
  
  // Multi-peer architecture
  const peersRef = useRef(new Map()); // peerId -> RTCPeerConnection
  const dataChannelsRef = useRef(new Map()); // peerId -> RTCDataChannel
  const pendingCandidatesRef = useRef(new Map()); // peerId -> RTCIceCandidate[]
  const dbRef = useRef(null);
  const [connectedPeersCount, setConnectedPeersCount] = useState(0);

  const getRTCConfiguration = useCallback(() => {
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ],
      iceCandidatePoolSize: allowMultiNetworkRef.current ? 10 : 5,
    };
  }, []);

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
    // When Background Mode is enabled, request notification permission for iOS queue alerts
    if (active) {
      setupBackgroundKeepAlive();
      await requestNotificationPermission();
    }
  };

  // Flush queued clipboard items to system clipboard when app returns to foreground (mobile)
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState === 'visible') {
        const success = await flushPendingQueue();
        if (!success && isIOS()) {
          setShowIosSyncOverlay(true);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    // Initialize mobile background audio to prevent suspension
    initMobileBackgroundSound();
    
    // Listen for UI reset from ephemerality wipe
    const handleMessage = (e) => {
      if (e.data?.type === 'UI_STATE_RESET') {
        setStatus('disconnected');
        setCurrentRoom(null);
        setTransferProgress(0);
        setIsTransferring(false);
        setReceivedFile(null);
        setMessages([]);
        setClipboardItems([]);
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
      peersRef.current.forEach(pc => pc.close());
      dataChannelsRef.current.forEach(dc => stopHeartbeat(dc));
    };
  }, []);

  const updateConnectionStatus = useCallback((room = currentRoom) => {
    let activeCount = 0;
    dataChannelsRef.current.forEach((dc) => {
      if (dc.readyState === 'open') activeCount++;
    });
    setConnectedPeersCount(activeCount);
    if (activeCount > 0) {
      setStatus('connected');
    } else if (room) {
      setStatus('waiting');
    } else {
      setStatus('disconnected');
    }
  }, [currentRoom]);

  const handleDisconnection = useCallback((peerId = null) => {
    if (peerId) {
      console.log(`[WebRTC] Disconnecting peer: ${peerId}`);
      const pc = peersRef.current.get(peerId);
      if (pc) pc.close();
      peersRef.current.delete(peerId);
      
      const dc = dataChannelsRef.current.get(peerId);
      if (dc) stopHeartbeat(dc);
      dataChannelsRef.current.delete(peerId);
      
      pendingCandidatesRef.current.delete(peerId);
      updateConnectionStatus();
    } else {
      console.log(`[WebRTC] Disconnecting all peers`);
      peersRef.current.forEach(pc => pc.close());
      peersRef.current.clear();
      dataChannelsRef.current.forEach(dc => stopHeartbeat(dc));
      dataChannelsRef.current.clear();
      pendingCandidatesRef.current.clear();
      setClipboardItems([]);
      wipeLocalCache();
      updateConnectionStatus(null);
    }
  }, [updateConnectionStatus]);

  const addMessage = useCallback((msg) => {
    setMessages(prev => [...prev, msg]);
  }, []);

  const handleAddClipboardItem = useCallback((item) => {
    let payloadItem = item;

    setClipboardItems(prev => {
      // Check if content already exists in session memory
      const existingIdx = prev.findIndex(i => i.content === item.content || i.id === item.id);
      if (existingIdx !== -1) {
        payloadItem = {
          ...prev[existingIdx],
          timestamp: Date.now()
        };
        const filtered = prev.filter((_, idx) => idx !== existingIdx);
        return [payloadItem, ...filtered].slice(0, 20);
      }
      return [item, ...prev].slice(0, 20);
    });

    dataChannelsRef.current.forEach(channel => {
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify({
          type: 'CLIPBOARD_ITEM',
          item: payloadItem
        }));
      }
    });
  }, []);

  useEffect(() => {
    if (status === 'connected' && isAndroid()) {
      startForegroundPoller((text) => handleAddClipboardItem({
        id: 'poller_' + Date.now().toString(36),
        itemType: 'text',
        content: text,
        timestamp: Date.now()
      }));
    } else {
      stopForegroundPoller();
    }
  }, [status, handleAddClipboardItem]);


  useEffect(() => {
    // Listen for incoming auto-clipboard syncs from the browser extension content script
    const handleExtensionMessage = (e) => {
      if (e.data?.type === 'EXTENSION_CLIPBOARD_ITEM') {
        handleAddClipboardItem({
          id: 'ext_' + Date.now().toString(36) + Math.random().toString(36).slice(2),
          itemType: e.data.itemType,
          content: e.data.content,
          timestamp: e.data.timestamp || Date.now()
        });
      }
    };
    window.addEventListener('message', handleExtensionMessage);
    return () => window.removeEventListener('message', handleExtensionMessage);
  }, [handleAddClipboardItem]);

  const setupDataChannel = useCallback((peerId, channel) => {
    dataChannelsRef.current.set(peerId, channel);
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 65536;

    const handleOpen = () => {
      if (channel !== dataChannelsRef.current.get(peerId)) return;
      updateConnectionStatus();
      startHeartbeat(channel, () => handleDisconnection(peerId));
    };

    channel.onopen = handleOpen;
    if (channel.readyState === 'open') {
      handleOpen();
    }

    channel.onclose = () => {
      if (channel !== dataChannelsRef.current.get(peerId)) return;
      handleDisconnection(peerId);
    };

    channel.onmessage = async (event) => {
      if (channel !== dataChannelsRef.current.get(peerId)) return;
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
        } else if (parsed.type === 'CLIPBOARD_ITEM') {
          setClipboardItems(prev => {
            const existingIdx = prev.findIndex(i => i.content === parsed.item.content || i.id === parsed.item.id);
            if (existingIdx !== -1) {
              const updatedItem = {
                ...prev[existingIdx],
                ...parsed.item,
                timestamp: parsed.item.timestamp || Date.now()
              };
              const filtered = prev.filter((_, idx) => idx !== existingIdx);
              return [updatedItem, ...filtered].slice(0, 20);
            }
            return [parsed.item, ...prev].slice(0, 20);
          });
          
          // Auto-copy clipboard logic (platform-aware)
          try {
            const handledByMobile = await handleIncomingClipboardItem(parsed.item);
            if (!handledByMobile) {
              // Desktop fallback: write only when tab is focused
              if (document.hasFocus()) {
                if (parsed.item.itemType === 'text') {
                  await navigator.clipboard.writeText(parsed.item.content);
                } else if (parsed.item.itemType === 'image') {
                  const res = await fetch(parsed.item.content);
                  const blob = await res.blob();
                  let clipboardBlob = blob;
                  if (blob.type !== 'image/png') {
                    const bmp = await createImageBitmap(blob);
                    const canvas = document.createElement('canvas');
                    canvas.width = bmp.width;
                    canvas.height = bmp.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(bmp, 0, 0);
                    clipboardBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
                  }
                  await navigator.clipboard.write([new ClipboardItem({ 'image/png': clipboardBlob })]);
                }
              }
            }
          } catch (e) {
            console.warn('WebRTC Clipboard auto-copy skipped:', e);
          }
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
          await autoDownloadFile();
          setIsTransferring(false);
          setTransferProgress(100);
          setReceivedFile({ name: parsed.fileName || parsed.fileId, id: parsed.fileId });
        }
      } else if (event.data instanceof ArrayBuffer) {
        await writeChunkToDisk(event.data);
      }
    };
  }, [handleDisconnection, addMessage, updateConnectionStatus]);

  const setupWebRTC = async (peerId, socket, room) => {
    console.log(`⚙️ [WebRTC] Initializing RTCPeerConnection for ${peerId} (MultiNetwork: ${allowMultiNetworkRef.current})...`);
    const pc = new RTCPeerConnection(getRTCConfiguration());
    peersRef.current.set(peerId, pc);
    pendingCandidatesRef.current.set(peerId, []);

    pc.ondatachannel = (event) => {
      if (pc !== peersRef.current.get(peerId)) return;
      console.log(`📥 [WebRTC] Received remote data channel from ${peerId}!`);
      setupDataChannel(peerId, event.channel);
    };

    pc.onicecandidate = async (event) => {
      if (pc !== peersRef.current.get(peerId)) return;
      if (event.candidate && cryptoKeyRef.current) {
        const candStr = event.candidate.candidate || '';
        // In Strict LAN mode (allowMultiNetwork === false), filter out non-LAN candidates
        if (!allowMultiNetworkRef.current && candStr.includes('typ relay')) {
          console.log(`🔒 [WebRTC] Strict LAN Mode: Suppressing relay candidate for ${peerId}:`, candStr);
          return;
        }

        console.log(`📤 [Socket.io] Emitting ICE candidate to peer ${peerId}...`);
        const encryptedCandidate = await encryptPayload(cryptoKeyRef.current, {
          roomId: room,
          targetId: peerId,
          type: 'ice-candidate',
          candidate: event.candidate
        });
        socket.emit('signal', { ...encryptedCandidate, targetId: peerId });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc !== peersRef.current.get(peerId)) return;
      console.log(`⚙️ [WebRTC] Connection state for ${peerId} changed to: ${pc.connectionState}`);
      updateConnectionStatus();
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        handleDisconnection(peerId);
      }
    };
    return pc;
  };

  const handleJoin = async (e, overrideRoomCode) => {
    if (e) e.preventDefault();
    const activeRoom = overrideRoomCode || roomCode;
    if (!activeRoom.trim()) return;
    
    // Clean up any existing connection first
    peersRef.current.forEach(pc => pc.close());
    peersRef.current.clear();
    dataChannelsRef.current.forEach(dc => stopHeartbeat(dc));
    dataChannelsRef.current.clear();

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    pendingCandidatesRef.current.clear();
    
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
      });

      socket.on('connect_error', (err) => {
        console.error("❌ [Socket.io] Connection error:", err.message, err);
      });

      socket.on('user-joined', async (data) => {
        if (socket !== socketRef.current) return;
        const targetId = data.peerId;
        console.log(`📥 [Socket.io] Received 'user-joined' from ${targetId}. Initiating WebRTC...`);
        if (!cryptoKeyRef.current) return;
        
        try {
          const pc = await setupWebRTC(targetId, socket, activeRoom);
          
          console.log(`⚙️ [WebRTC] Creating data channel for ${targetId}...`);
          const dc = pc.createDataChannel("fileTransferChannel");
          setupDataChannel(targetId, dc);

          console.log(`⚙️ [WebRTC] Creating local SDP offer for ${targetId}...`);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          
          console.log(`📤 [Socket.io] Sending SDP offer to ${targetId}...`);
          const encryptedOffer = await encryptPayload(cryptoKeyRef.current, {
            roomId: activeRoom,
            targetId: targetId,
            type: 'offer',
            offer
          });
          socket.emit('signal', { ...encryptedOffer, targetId: targetId });
        } catch (error) {
          console.error(`❌ [WebRTC] Failed to create offer for ${targetId}`, error);
        }
      });

      socket.on('user-left', (data) => {
        if (socket !== socketRef.current) return;
        console.log(`[Socket.io] user-left received for ${data.peerId}`);
        handleDisconnection(data.peerId);
      });

      socket.on('signal', async (encryptedPayload) => {
        if (socket !== socketRef.current) return;
        if (!cryptoKeyRef.current) return;
        
        try {
          const payload = await decryptPayload(cryptoKeyRef.current, encryptedPayload);
          const senderId = encryptedPayload.senderId;
          if (!senderId) {
            console.error("❌ [WebRTC] Missing senderId on incoming signal!");
            return;
          }
          console.log(`📥 [Socket.io] Decrypted signal: type = ${payload.type} from ${senderId}`);
          
          let pc = peersRef.current.get(senderId);
          if (!pc && payload.type === 'offer') {
            pc = await setupWebRTC(senderId, socket, activeRoom);
          }
          if (!pc) return;

          if (payload.type === 'offer') {
            console.log(`⚙️ [WebRTC] Setting remote SDP offer from ${senderId}...`);
            await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
            // Flush any queued candidates
            console.log(`⚙️ [WebRTC] Processing queued ICE candidates for ${senderId}...`);
            const queued = pendingCandidatesRef.current.get(senderId) || [];
            for (const candidate of queued) {
              try {
                const candStr = candidate?.candidate || '';
                if (!allowMultiNetworkRef.current && candStr.includes('typ relay')) {
                  continue;
                }
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {
                console.error("❌ [WebRTC] Error adding queued ice candidate", e);
              }
            }
            pendingCandidatesRef.current.set(senderId, []);

            console.log(`⚙️ [WebRTC] Creating local SDP answer for ${senderId}...`);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            console.log(`📤 [Socket.io] Sending SDP answer to ${senderId}...`);
            const encryptedAnswer = await encryptPayload(cryptoKeyRef.current, {
              roomId: activeRoom,
              targetId: senderId,
              type: 'answer',
              answer
            });
            socket.emit('signal', { ...encryptedAnswer, targetId: senderId });
          } else if (payload.type === 'answer') {
            console.log(`⚙️ [WebRTC] Setting remote SDP answer from ${senderId}...`);
            await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
            // Flush any queued candidates
            const queued = pendingCandidatesRef.current.get(senderId) || [];
            for (const candidate of queued) {
              try {
                const candStr = candidate?.candidate || '';
                if (!allowMultiNetworkRef.current && candStr.includes('typ relay')) {
                  continue;
                }
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {
                console.error("❌ [WebRTC] Error adding queued ice candidate", e);
              }
            }
            pendingCandidatesRef.current.set(senderId, []);
          } else if (payload.type === 'ice-candidate') {
            const candStr = payload.candidate?.candidate || '';
            if (!allowMultiNetworkRef.current && candStr.includes('typ relay')) {
              console.log(`🔒 [WebRTC] Strict LAN Mode: Suppressing remote relay candidate from ${senderId}`);
            } else {
              if (pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
              } else {
                console.log(`⚙️ [WebRTC] Queueing ICE candidate for ${senderId}...`);
                const queue = pendingCandidatesRef.current.get(senderId) || [];
                queue.push(payload.candidate);
                pendingCandidatesRef.current.set(senderId, queue);
              }
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
    let hasOpenChannel = false;
    dataChannelsRef.current.forEach(channel => {
      if (channel.readyState === 'open') hasOpenChannel = true;
    });
    if (!hasOpenChannel) return;
    
    setIsTransferring(true);
    setTransferProgress(0);

    const uuid = typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : Math.random().toString(36).substring(2) + Date.now().toString(36);

    const metadataPayload = JSON.stringify({
      type: 'FILE_METADATA',
      id: uuid,
      name: file.name,
      size: file.size,
      mimeType: file.type
    });

    dataChannelsRef.current.forEach(channel => {
      if (channel.readyState === 'open') {
        channel.send(metadataPayload);
        sendFileChunks(file, channel, (progress) => {
          setTransferProgress(progress);
          if (progress >= 100) {
            setIsTransferring(false);
          }
        });
      }
    });
  };

  const handleSendChat = useCallback((text) => {
    let hasOpenChannel = false;
    dataChannelsRef.current.forEach(channel => {
      if (channel.readyState === 'open') hasOpenChannel = true;
    });
    if (!hasOpenChannel) return;

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const msg = { id, text, sender: 'me', timestamp: Date.now() };
    addMessage(msg);
    
    const payload = JSON.stringify({
      type: 'CHAT_MESSAGE',
      id,
      text,
      timestamp: msg.timestamp,
    });

    dataChannelsRef.current.forEach(channel => {
      if (channel.readyState === 'open') {
        channel.send(payload);
      }
    });
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

  const statusLabel = status === 'connected' 
    ? `Connected (${connectedPeersCount + 1})` 
    : {
        waiting:     'Waiting for Peers',
        connecting:  'Connecting…',
        disconnected:'Disconnected',
      }[status];

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-zinc-200 font-sans selection:bg-indigo-500/30">
      <div className="max-w-[1600px] mx-auto p-4 md:p-8">
        {/* Header with Integrated Secure Pairing */}
        <header className="bg-zinc-900/40 border border-zinc-800/60 rounded-2xl p-4 md:p-6 mb-8 backdrop-blur-md shadow-xl flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-xl font-medium tracking-tight text-white">Ephemeral Suite</h1>
              <p className="text-xs text-zinc-500 font-mono">P2P Continuity &amp; Clipboard</p>
            </div>
          </div>

          {/* Integrated Pairing & Network Controls */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Multi-Network / Local LAN Sync Toggle */}
            <button
              onClick={handleToggleMultiNetwork}
              title={
                allowMultiNetwork
                  ? "Multi-Network Sync ON: STUN enabled. Connects devices across different networks (4G/Wi-Fi)"
                  : "Strict LAN Mode ON: Zero STUN. Strictly pairs devices on the SAME local network (Wi-Fi/Ethernet)"
              }
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all flex items-center space-x-1.5 ${
                allowMultiNetwork
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                  : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
              }`}
            >
              {allowMultiNetwork ? (
                <>
                  <Globe className="w-3.5 h-3.5 text-amber-400" />
                  <span>Multi-Network (4G/WAN)</span>
                </>
              ) : (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Strict LAN Only</span>
                </>
              )}
            </button>

            {status === 'disconnected' ? (
              <form onSubmit={handleJoin} className="flex items-center space-x-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    id="roomCode"
                    type="text"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value)}
                    placeholder="Enter Room Code..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 pl-9 pr-3 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 font-mono text-xs transition-all"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-2 px-4 text-xs font-medium transition-all shadow-md shadow-indigo-500/10 whitespace-nowrap"
                >
                  Connect
                </button>
              </form>
            ) : (
              <>
                {/* Status Badge */}
                <div className={`px-3 py-1.5 rounded-xl text-xs font-medium border flex items-center space-x-2 ${statusBadge}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
                  <span>{statusLabel}</span>
                  {currentRoom && <span className="font-mono opacity-70">({currentRoom})</span>}
                </div>

                {/* Disconnect Button */}
                <button
                  onClick={() => {
                    handleDisconnection();
                    setStatus('disconnected');
                    setCurrentRoom(null);
                    setMessages([]);
                    setReceivedFile(null);
                    setIsTransferring(false);
                    setClipboardItems([]);
                  }}
                  className="bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-xl py-1.5 px-3 text-xs font-medium border border-zinc-700 transition-colors"
                >
                  Disconnect
                </button>
              </>
            )}

            {/* Background Mode PiP Button */}
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
        <main className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

          {/* ── COLUMN 1: Chat ── */}
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

          {/* ── COLUMN 2: Shared Session Clipboard ── */}
          <section>
            <ClipboardPanel
              items={clipboardItems}
              onPasteItem={handleAddClipboardItem}
              onClear={() => setClipboardItems([])}
              disabled={status !== 'connected'}
            />
          </section>

          {/* ── COLUMN 3: Data Pipeline ── */}
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

      {/* iOS Safari 'Tap to Sync' Overlay Fallback */}
      {showIosSyncOverlay && (
        <div 
          className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-md flex items-center justify-center cursor-pointer"
          onClick={async () => {
            const success = await flushPendingQueue();
            if (success) setShowIosSyncOverlay(false);
          }}
        >
          <div className="bg-zinc-900 border border-zinc-700 p-8 rounded-2xl shadow-2xl flex flex-col items-center max-w-sm mx-4 text-center">
            <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mb-6">
              <Zap className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-xl font-medium text-white mb-2">Tap to Sync</h3>
            <p className="text-sm text-zinc-400">
              Safari requires a tap to paste the items received while you were away.
            </p>
            <button className="mt-8 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-medium shadow-lg shadow-indigo-500/20 transition-all w-full">
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
