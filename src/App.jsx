import React, { useState, useRef, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import { deriveKey, encryptPayload, decryptPayload } from './lib/crypto';
import { Shield, Key, Zap, Link2, HardDrive, Lock, Tv, Wifi, Globe, CheckCircle, QrCode, HelpCircle, Code2, Users } from 'lucide-react';
import DragDropZone from './components/DragDropZone';
import ChatPanel from './components/ChatPanel';
import ClipboardPanel from './components/ClipboardPanel';
import PairDeviceCard from './components/PairDeviceCard';
import QRPairingModal from './components/QRPairingModal';
import ConnectionRequest from './components/ConnectionRequest';
import ConnectedDevicesModal from './components/ConnectedDevicesModal';
import { sendFileChunks } from './lib/dataChannel';
import { initializeOPFS, writeChunkToDisk, finalizeFile, autoDownloadFile, verifyChecksum, initializeIndexedDB, saveMetadata } from './lib/storage';
import { startHeartbeat, handleHeartbeatMessage, stopHeartbeat, wipeLocalCache } from './lib/ephemerality';
import { updateBackgroundPiPState, togglePictureInPicture, requestWakeLock, releaseWakeLock, setupBackgroundKeepAlive, initMobileBackgroundSound } from './lib/backgroundMode';
import { handleIncomingClipboardItem, flushPendingQueue, requestNotificationPermission, startForegroundPoller, stopForegroundPoller, isAndroid } from './lib/mobileClipboard';
import { motion, AnimatePresence } from 'motion/react';

// Utility for device identification
function getDeviceName() {
  const ua = navigator.userAgent;
  let browser = "Unknown Browser";
  let os = "Unknown OS";
  
  if (ua.includes("Firefox/")) browser = "Firefox";
  else if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("Chrome/")) browser = "Chrome";
  else if (ua.includes("Safari/") && !ua.includes("Chrome/")) browser = "Safari";

  if (ua.includes("Win")) os = "Windows";
  else if (ua.includes("Mac")) os = "Mac";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("like Mac OS X")) os = "iOS";

  return `${browser} on ${os}`;
}

// Generate a random room code in XXXX-XXXX format (no 0, O, 1, I, L)
function generateRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getStoredRoomCode() {
  const stored = sessionStorage.getItem('pecs_room_code');
  if (stored && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(stored)) return stored;
  const newCode = generateRoomCode();
  sessionStorage.setItem('pecs_room_code', newCode);
  return newCode;
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export default function App() {
  // Connection state
  const [roomCode, setRoomCode] = useState(getStoredRoomCode);
  const [currentRoom, setCurrentRoom] = useState(null); // The room we are actively listening/joined to
  const [status, setStatus] = useState('disconnected'); // 'disconnected', 'listening', 'connected'
  const [connectedPeers, setConnectedPeers] = useState([]); // [{id, deviceName, isLocal}]
  
  // Modals & Overlays
  const [showQRModal, setShowQRModal] = useState(false);
  const [showDevicesModal, setShowDevicesModal] = useState(false);
  
  // Connection Requests
  const [pendingRequests, setPendingRequests] = useState([]); // Queue of incoming connection requests
  const [isWaitingForApproval, setIsWaitingForApproval] = useState(false); // Guest waiting for owner to accept

  // File Transfer State
  const [transferProgress, setTransferProgress] = useState(0);
  const [isTransferring, setIsTransferring] = useState(false);
  const [receivedFile, setReceivedFile] = useState(null);
  const [sentFileSuccess, setSentFileSuccess] = useState(null);

  const roomCodeRef = useRef(roomCode);
  useEffect(() => { roomCodeRef.current = roomCode; }, [roomCode]);

  // Initialize Local Storage Code and Check URL Hash
  useEffect(() => {
    if (!roomCode) {
      setRoomCode(getStoredRoomCode());
    }

    // Check for room code in URL hash
    if (window.location.hash) {
      const hash = window.location.hash.substring(1); // remove '#'
      const match = hash.match(/([A-Z0-9]{4}-[A-Z0-9]{4})/);
      if (match) {
        const urlCode = match[1];
        // Strip the hash from the URL silently
        window.history.replaceState(null, '', window.location.pathname);
        
        // Auto join
        setPendingRequests([]);
        setIsWaitingForApproval(true);
        joinSocketRoom(urlCode);
      }
    }
  }, []);

  const activeTransferRef = useRef({
    fileId: null,
    fileName: '',
    pendingPeerIds: new Set(),
    timeoutId: null
  });

  // Chat, Clipboard & Background state
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

  useEffect(() => {
    if (isTransferring) requestWakeLock();
    else releaseWakeLock();
  }, [isTransferring]);

  const handleTogglePiP = async () => {
    const active = await togglePictureInPicture();
    setPipActive(active);
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

  // Play subtle notification sound
  const playNotificationSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
      if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
    } catch (e) {
      // Ignore if audio context fails to initialize
    }
  };

  // Auto-join own room on mount
  useEffect(() => {
    initMobileBackgroundSound();
    initializeIndexedDB().then(db => { dbRef.current = db; }).catch(console.error);

    const handleMessage = (e) => {
      if (e.data?.type === 'UI_STATE_RESET') {
        setStatus('listening');
        setTransferProgress(0);
        setIsTransferring(false);
        setReceivedFile(null);
        setMessages([]);
        setClipboardItems([]);
      }
    };
    window.addEventListener('message', handleMessage);

    // Silently join the room we own
    joinSocketRoom(roomCode);

    return () => {
      window.removeEventListener('message', handleMessage);
      socketRef.current?.disconnect();
      peersRef.current.forEach(pc => pc.close());
      dataChannelsRef.current.forEach(dc => stopHeartbeat(dc));
    };
  }, []);

  const updateConnectionStatus = useCallback(async (room = currentRoom) => {
    const activePeers = [];
    
      // Evaluate active connections and determine local/relay status
    for (const [peerId, dc] of dataChannelsRef.current.entries()) {
      if (dc.readyState === 'open') {
        const pc = peersRef.current.get(peerId);
        let isLocal = true;
        if (pc) {
          try {
            const stats = await pc.getStats();
            stats.forEach(report => {
              if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                const local = stats.get(report.localCandidateId);
                const remote = stats.get(report.remoteCandidateId);
                if (local && (local.candidateType === 'srflx' || local.candidateType === 'relay')) isLocal = false;
                if (remote && (remote.candidateType === 'srflx' || remote.candidateType === 'relay')) isLocal = false;
              }
            });
          } catch (e) { }
        }
        activePeers.push({ id: peerId, deviceName: 'Connected Peer', isLocal });
      }
    }

    setConnectedPeers(activePeers);
    if (activePeers.length > 0) {
      setStatus('connected');
      setIsWaitingForApproval(false);
    } else {
      setStatus('listening');
      if (activeTransferRef.current.timeoutId) {
        clearTimeout(activeTransferRef.current.timeoutId);
      }
      activeTransferRef.current = { fileId: null, fileName: '', pendingPeerIds: new Set(), timeoutId: null };
      setIsTransferring(false);
      setTransferProgress(0);
    }
  }, [currentRoom]);

  const checkTransferACKComplete = useCallback(() => {
    if (activeTransferRef.current.fileId && activeTransferRef.current.pendingPeerIds.size === 0) {
      console.log('✅ [WebRTC] All recipients acknowledged file receipt!');
      if (activeTransferRef.current.timeoutId) {
        clearTimeout(activeTransferRef.current.timeoutId);
      }
      const completedFileName = activeTransferRef.current.fileName;
      activeTransferRef.current = { fileId: null, fileName: '', pendingPeerIds: new Set(), timeoutId: null };
      setTransferProgress(100);
      setIsTransferring(false);
      if (completedFileName) {
        setSentFileSuccess({ name: completedFileName });
      }
    }
  }, []);

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

      if (activeTransferRef.current.fileId) {
        activeTransferRef.current.pendingPeerIds.delete(peerId);
        checkTransferACKComplete();
      }

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
      updateConnectionStatus();
    }
  }, [updateConnectionStatus, checkTransferACKComplete]);

  const joinSocketRoom = async (room) => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    peersRef.current.forEach(pc => pc.close());
    peersRef.current.clear();
    dataChannelsRef.current.clear();
    pendingCandidatesRef.current.clear();
    
    try {
      cryptoKeyRef.current = await deriveKey(room);
      setCurrentRoom(room);
      setStatus('listening');

      const socket = io();
      socketRef.current = socket;

      socket.on('connect', () => {
        if (socket !== socketRef.current) return;
        console.log(`🟢 [Socket.io] Connected successfully. Joining room: ${room}`);
        socket.emit('join-room', room);

        // Tell anyone already in the room who we are (if we are joining someone else's room)
        if (room !== roomCodeRef.current) {
          encryptPayload(cryptoKeyRef.current, {
            roomId: room,
            targetId: 'broadcast',
            type: 'device-info',
            deviceName: getDeviceName()
          }).then(infoPayload => {
            socket.emit('signal', { ...infoPayload, targetId: room });
          });
        }
      });

      socket.on('user-joined', (data) => {
        if (socket !== socketRef.current) return;
        console.log(`📥 [Socket.io] Received 'user-joined' from ${data.peerId}.`);
        
        // If we are the code owner and someone joins our room, queue an accept prompt
        // (If we joined someone else's room, we will be waiting for their offer)
        if (room === roomCodeRef.current) {
          playNotificationSound();
          setPendingRequests(prev => [...prev, {
            peerId: data.peerId,
            deviceName: 'Unknown Device', // We'll negotiate device name later via signaling if needed
            timestamp: Date.now()
          }]);
        }
      });

      socket.on('user-left', (data) => {
        if (socket !== socketRef.current) return;
        console.log(`[Socket.io] user-left received for ${data.peerId}`);
        handleDisconnection(data.peerId);
        // Remove from pending requests if they left before we answered
        setPendingRequests(prev => prev.filter(req => req.peerId !== data.peerId));
        if (room !== roomCodeRef.current && pendingRequests.length === 0) {
           setIsWaitingForApproval(false);
        }
      });

      socket.on('signal', async (encryptedPayload) => {
        if (socket !== socketRef.current) return;
        if (!cryptoKeyRef.current) return;
        
        try {
          const payload = await decryptPayload(cryptoKeyRef.current, encryptedPayload);
          const senderId = encryptedPayload.senderId;
          if (!senderId) return;

          // Device Name exchange via signaling
          if (payload.type === 'device-info') {
            if (room === roomCodeRef.current) {
              setPendingRequests(prev => prev.map(req => 
                req.peerId === senderId ? { ...req, deviceName: payload.deviceName } : req
              ));
            } else {
              // Send our device info back
              const infoPayload = await encryptPayload(cryptoKeyRef.current, {
                roomId: room,
                targetId: senderId,
                type: 'device-info',
                deviceName: getDeviceName()
              });
              socket.emit('signal', { ...infoPayload, targetId: senderId });
            }
            return;
          }

          console.log(`📥 [Socket.io] Decrypted signal: type = ${payload.type} from ${senderId}`);
          
          if (payload.type === 'mesh-auth') {
            console.log(`[Mesh] Owner authorized ${payload.newPeerId}. Initiating WebRTC...`);
            const targetPeerId = payload.newPeerId;
            let pc = peersRef.current.get(targetPeerId);
            if (!pc) {
              pc = await setupWebRTC(targetPeerId, socket, room);
              const dc = pc.createDataChannel("fileTransferChannel");
              setupDataChannel(targetPeerId, dc);
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              const encryptedOffer = await encryptPayload(cryptoKeyRef.current, {
                roomId: room,
                targetId: targetPeerId,
                type: 'offer',
                offer
              });
              socket.emit('signal', { ...encryptedOffer, targetId: targetPeerId });
            }
            return;
          }

          let pc = peersRef.current.get(senderId);
          if (!pc && payload.type === 'offer') {
            pc = await setupWebRTC(senderId, socket, room);
          }
          if (!pc) return;

          if (payload.type === 'offer') {
            console.log(`⚙️ [WebRTC] Setting remote SDP offer from ${senderId}...`);
            await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
            
            const queued = pendingCandidatesRef.current.get(senderId) || [];
            for (const candidate of queued) {
              try {
                const candStr = candidate?.candidate || '';
                if (!allowMultiNetworkRef.current && candStr.includes('typ relay')) continue;
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {}
            }
            pendingCandidatesRef.current.set(senderId, []);

            console.log(`⚙️ [WebRTC] Creating local SDP answer for ${senderId}...`);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            console.log(`📤 [Socket.io] Sending SDP answer to ${senderId}...`);
            const encryptedAnswer = await encryptPayload(cryptoKeyRef.current, {
              roomId: room,
              targetId: senderId,
              type: 'answer',
              answer
            });
            socket.emit('signal', { ...encryptedAnswer, targetId: senderId });
          } else if (payload.type === 'answer') {
            console.log(`⚙️ [WebRTC] Setting remote SDP answer from ${senderId}...`);
            await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
            
            const queued = pendingCandidatesRef.current.get(senderId) || [];
            for (const candidate of queued) {
              try {
                const candStr = candidate?.candidate || '';
                if (!allowMultiNetworkRef.current && candStr.includes('typ relay')) continue;
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {}
            }
            pendingCandidatesRef.current.set(senderId, []);
          } else if (payload.type === 'ice-candidate') {
            const candStr = payload.candidate?.candidate || '';
            if (!allowMultiNetworkRef.current && candStr.includes('typ relay')) {
              console.log(`🔒 [WebRTC] Strict LAN Mode: Suppressing remote relay candidate`);
            } else {
              if (pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
              } else {
                console.log(`⚙️ [WebRTC] Queueing ICE candidate...`);
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
    }
  };

  const setupWebRTC = async (peerId, socket, room) => {
    console.log(`⚙️ [WebRTC] Initializing RTCPeerConnection for ${peerId}...`);
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
        if (!allowMultiNetworkRef.current && candStr.includes('typ relay')) return;
        
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

  const setupDataChannel = useCallback((peerId, channel) => {
    dataChannelsRef.current.set(peerId, channel);
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 1048576;

    const handleOpen = () => {
      if (channel !== dataChannelsRef.current.get(peerId)) return;
      updateConnectionStatus();
      startHeartbeat(channel, () => handleDisconnection(peerId));
      
      // Negotiate device name over DC if needed, but we already updated status
      setConnectedPeers(prev => prev.map(p => 
        p.id === peerId && p.deviceName === 'Connected Peer' 
          ? { ...p, deviceName: getDeviceName() } // Replace our own logic here for display
          : p
      ));
      // Send our device info over DC once connected so the other side knows who we are
      channel.send(JSON.stringify({
        type: 'DEVICE_INFO',
        deviceName: getDeviceName()
      }));
    };

    channel.onopen = handleOpen;
    if (channel.readyState === 'open') handleOpen();

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
        } else if (parsed.type === 'DEVICE_INFO') {
           setConnectedPeers(prev => prev.map(p => p.id === peerId ? { ...p, deviceName: parsed.deviceName } : p));
        } else if (parsed.type === 'CHAT_MESSAGE') {
          setMessages(prev => [...prev, {
            id: parsed.id, text: parsed.text, sender: 'peer', timestamp: parsed.timestamp
          }]);
        } else if (parsed.type === 'CLIPBOARD_ITEM') {
          setClipboardItems(prev => {
            const existingIdx = prev.findIndex(i => i.content === parsed.item.content || i.id === parsed.item.id);
            if (existingIdx !== -1) {
              const updatedItem = { ...prev[existingIdx], ...parsed.item, timestamp: parsed.item.timestamp || Date.now() };
              const filtered = prev.filter((_, idx) => idx !== existingIdx);
              return [updatedItem, ...filtered].slice(0, 20);
            }
            return [parsed.item, ...prev].slice(0, 20);
          });
          
          try {
            const handledByMobile = await handleIncomingClipboardItem(parsed.item);
            if (!handledByMobile && document.hasFocus()) {
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
          } catch (e) {
            console.warn('WebRTC Clipboard auto-copy skipped:', e);
          }
        } else if (parsed.type === 'FILE_METADATA') {
          setIsTransferring(true);
          setTransferProgress(0);
          setReceivedFile(null);
          await initializeOPFS(parsed.name);
          if (dbRef.current) await saveMetadata(dbRef.current, { fileId: parsed.id, name: parsed.name, size: parsed.size });
        } else if (parsed.type === 'EOF') {
          await finalizeFile();
          const checksumResult = await verifyChecksum(parsed.checksum || null);
          if (!checksumResult.ok && parsed.checksum) {
            setIsTransferring(false);
            setTransferProgress(0);
            channel.send(JSON.stringify({ type: 'FILE_CHECKSUM_FAIL', fileId: parsed.fileId || parsed.fileName, expected: checksumResult.expected, actual: checksumResult.actual }));
            return;
          }
          await autoDownloadFile();
          setIsTransferring(false);
          setTransferProgress(100);
          setReceivedFile({ name: parsed.fileName || parsed.fileId, id: parsed.fileId });
          channel.send(JSON.stringify({ type: 'FILE_ACK', fileId: parsed.fileId || parsed.fileName, verified: true }));
        } else if (parsed.type === 'FILE_CHECKSUM_FAIL') {
          if (activeTransferRef.current.fileId === parsed.fileId) {
            activeTransferRef.current.pendingPeerIds.delete(peerId);
          }
        } else if (parsed.type === 'FILE_ACK') {
          if (activeTransferRef.current.fileId === parsed.fileId) {
            activeTransferRef.current.pendingPeerIds.delete(peerId);
            checkTransferACKComplete();
          }
        }
      } else if (event.data instanceof ArrayBuffer) {
        await writeChunkToDisk(event.data);
      }
    };
  }, [updateConnectionStatus, handleDisconnection, checkTransferACKComplete]);

  // Handle Accept Connection Request (Owner)
  const handleAcceptRequest = async (peerId) => {
    setPendingRequests(prev => prev.filter(req => req.peerId !== peerId));
    if (!socketRef.current || !cryptoKeyRef.current) return;
    
    try {
      const pc = await setupWebRTC(peerId, socketRef.current, currentRoom);
      console.log(`⚙️ [WebRTC] Creating data channel for ${peerId}...`);
      const dc = pc.createDataChannel("fileTransferChannel");
      setupDataChannel(peerId, dc);

      console.log(`⚙️ [WebRTC] Creating local SDP offer for ${peerId}...`);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      console.log(`📤 [Socket.io] Sending SDP offer to ${peerId}...`);
      const encryptedOffer = await encryptPayload(cryptoKeyRef.current, {
        roomId: currentRoom,
        targetId: peerId,
        type: 'offer',
        offer
      });
      socketRef.current.emit('signal', { ...encryptedOffer, targetId: peerId });
      
      // Tell other connected peers to connect to this new peer
      for (const [existingPeerId, _] of peersRef.current.entries()) {
        if (existingPeerId !== peerId) {
          const authPayload = await encryptPayload(cryptoKeyRef.current, {
            roomId: currentRoom,
            targetId: existingPeerId,
            type: 'mesh-auth',
            newPeerId: peerId
          });
          socketRef.current.emit('signal', { ...authPayload, targetId: existingPeerId });
        }
      }
    } catch (error) {
      console.error(`❌ [WebRTC] Failed to create offer for ${peerId}`, error);
    }
  };

  // Handle Decline Connection Request (Owner)
  const handleDeclineRequest = (peerId) => {
    setPendingRequests(prev => prev.filter(req => req.peerId !== peerId));
    // The peer will just sit waiting for an offer that never comes, which is fine
  };

  // Manual Join / QR Join (Guest)
  const handleJoinAnotherRoom = async (code) => {
    if (!code || !code.trim()) return;
    setPendingRequests([]);
    setIsWaitingForApproval(true);
    joinSocketRoom(code); // Joins their room and waits for them to send an offer
    
    // Automatically reset waiting state after 45 seconds if no offer is received
    setTimeout(() => {
      setIsWaitingForApproval(prev => {
        if (prev && status !== 'connected') {
          console.warn("Connection request timed out.");
          // Could show a toast here, but for now just reset UI
          return false;
        }
        return prev;
      });
    }, 45000);
  };

  const handleRandomizeCode = () => {
    const newCode = generateRoomCode();
    sessionStorage.setItem('pecs_room_code', newCode);
    setRoomCode(newCode);
    setPendingRequests([]);
    joinSocketRoom(newCode);
  };

  const handleFileSelect = (file) => {
    if (!file) return;
    const openChannels = [];
    dataChannelsRef.current.forEach((channel, peerId) => {
      if (channel.readyState === 'open') openChannels.push({ peerId, channel });
    });
    if (openChannels.length === 0) return;

    const uuid = typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : Math.random().toString(36).substring(2) + Date.now().toString(36);

    const metadataPayload = JSON.stringify({ type: 'FILE_METADATA', id: uuid, name: file.name, size: file.size, mimeType: file.type });

    if (activeTransferRef.current.timeoutId) clearTimeout(activeTransferRef.current.timeoutId);

    const pendingPeerIds = new Set(openChannels.map(c => c.peerId));
    activeTransferRef.current = { fileId: uuid, fileName: file.name, pendingPeerIds, timeoutId: null };

    setSentFileSuccess(null);
    setReceivedFile(null);
    setIsTransferring(true);
    setTransferProgress(0);

    try {
      openChannels.forEach(({ channel }) => {
        channel.send(metadataPayload);
        sendFileChunks(file, channel, (progress) => setTransferProgress(progress), uuid)
          .catch(err => { setIsTransferring(false); });
      });
    } catch (err) { setIsTransferring(false); }

    activeTransferRef.current.timeoutId = setTimeout(() => {
      if (activeTransferRef.current.fileId === uuid) {
        const completedFileName = activeTransferRef.current.fileName;
        activeTransferRef.current = { fileId: null, fileName: '', pendingPeerIds: new Set(), timeoutId: null };
        setTransferProgress(100);
        setIsTransferring(false);
        if (completedFileName) setSentFileSuccess({ name: completedFileName });
      }
    }, 45000);
  };

  const handleSendChat = useCallback((text) => {
    let hasOpenChannel = false;
    dataChannelsRef.current.forEach(channel => { if (channel.readyState === 'open') hasOpenChannel = true; });
    if (!hasOpenChannel) return;

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const msg = { id, text, sender: 'me', timestamp: Date.now() };
    setMessages(prev => [...prev, msg]);
    
    const payload = JSON.stringify({ type: 'CHAT_MESSAGE', id, text, timestamp: msg.timestamp });
    dataChannelsRef.current.forEach(channel => {
      if (channel.readyState === 'open') channel.send(payload);
    });
  }, []);

  const handleAddClipboardItem = useCallback((item) => {
    let payloadItem = item;
    setClipboardItems(prev => {
      const existingIdx = prev.findIndex(i => i.content === item.content || i.id === item.id);
      if (existingIdx !== -1) {
        payloadItem = { ...prev[existingIdx], timestamp: Date.now() };
        const filtered = prev.filter((_, idx) => idx !== existingIdx);
        return [payloadItem, ...filtered].slice(0, 20);
      }
      return [item, ...prev].slice(0, 20);
    });

    dataChannelsRef.current.forEach(channel => {
      if (channel.readyState === 'open') channel.send(JSON.stringify({ type: 'CLIPBOARD_ITEM', item: payloadItem }));
    });
  }, []);

  useEffect(() => {
    if (status === 'connected' && isAndroid()) {
      startForegroundPoller((text) => handleAddClipboardItem({
        id: 'poller_' + Date.now().toString(36), itemType: 'text', content: text, timestamp: Date.now()
      }));
    } else {
      stopForegroundPoller();
    }
  }, [status, handleAddClipboardItem]);

  useEffect(() => {
    const handleExtensionMessage = (e) => {
      if (e.data?.type === 'EXTENSION_CLIPBOARD_ITEM') {
        handleAddClipboardItem({
          id: 'ext_' + Date.now().toString(36) + Math.random().toString(36).slice(2),
          itemType: e.data.itemType, content: e.data.content, timestamp: e.data.timestamp || Date.now()
        });
      }
    };
    window.addEventListener('message', handleExtensionMessage);
    return () => window.removeEventListener('message', handleExtensionMessage);
  }, [handleAddClipboardItem]);


  const isConnected = status === 'connected';
  const isListening = status === 'listening';
  
  // Clean up pending requests that might have expired
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setPendingRequests(prev => prev.filter(req => now - req.timestamp < 30000)); // 30s timeout
    }, 5000);
    return () => clearInterval(interval);
  }, []);


  return (
    <div className="min-h-screen font-sans flex flex-col" style={{ background: 'var(--pecs-bg)', color: 'var(--pecs-text)' }}>
      {/* ═══════════════════════ CONNECTION REQUEST STACK ═══════════════════════ */}
      <AnimatePresence>
        {pendingRequests.map(req => (
          <ConnectionRequest 
            key={req.peerId} 
            request={req} 
            onAccept={handleAcceptRequest} 
            onDecline={handleDeclineRequest} 
          />
        ))}
      </AnimatePresence>

      <div className="max-w-[1400px] mx-auto p-4 md:p-6 lg:p-8 w-full flex-1 flex flex-col">

        {/* ═══════════════════════ HEADER ═══════════════════════ */}
        <motion.header
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="pecs-panel px-5 py-3.5 mb-6 flex items-center justify-between z-40 relative"
        >
          {/* Logo */}
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--pecs-accent-dim)', border: '1px solid rgba(45,212,191,0.2)' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 1L14.5 5V11L8 15L1.5 11V5L8 1Z" stroke="var(--pecs-accent)" strokeWidth="1.5" fill="var(--pecs-accent-glow)" />
                <path d="M8 5L11 7V11L8 13L5 11V7L8 5Z" fill="var(--pecs-accent)" opacity="0.6" />
              </svg>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-base font-bold text-white tracking-tight">PECS</span>
              <span className="text-xs font-medium tracking-wider uppercase hidden sm:inline"
                style={{ color: 'var(--pecs-text-muted)' }}>
                PRIVATE EXCHANGE
              </span>
            </div>
          </div>

          {/* Right side controls */}
          <div className="flex items-center space-x-2.5">
            {/* Network Mode Badge */}
            <button
              onClick={handleToggleMultiNetwork}
              title={allowMultiNetwork ? "Multi-Network Sync ON: STUN enabled" : "Strict LAN Mode: Zero STUN, local only"}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all"
              style={{
                background: allowMultiNetwork ? 'rgba(245,158,11,0.1)' : 'var(--pecs-accent-dim)',
                color: allowMultiNetwork ? 'var(--pecs-warning)' : 'var(--pecs-accent)',
                border: `1px solid ${allowMultiNetwork ? 'rgba(245,158,11,0.2)' : 'rgba(45,212,191,0.2)'}`,
              }}
            >
              {allowMultiNetwork ? (
                <>
                  <Globe className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Multi-Network</span>
                </>
              ) : (
                <>
                  <Wifi className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">LOCAL-ONLY</span>
                </>
              )}
            </button>

            {/* Connection status / Disconnect */}
            {isConnected && (
              <AnimatePresence>
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center space-x-2 relative"
                >
                  <motion.button 
                    layoutId="connected-devices-modal"
                    onClick={() => setShowDevicesModal(true)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-colors hover:bg-white/5"
                    style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--pecs-success)', border: '1px solid rgba(34,197,94,0.2)' }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--pecs-success)' }} />
                    <span>Connected ({connectedPeers.length})</span>
                  </motion.button>

                  <div className="relative">
                    <motion.button
                      layoutId="qr-modal"
                      onClick={() => setShowQRModal(true)}
                      className="p-1.5 rounded-lg transition-colors shadow-sm hover:bg-white/10"
                      style={{ 
                        background: 'var(--pecs-surface)',
                        color: 'var(--pecs-text-muted)',
                        border: '1px solid var(--pecs-border)'
                      }}
                      title="Show Room Code & QR"
                    >
                      <QrCode className="w-4 h-4" />
                    </motion.button>
                  </div>
                </motion.div>
              </AnimatePresence>
            )}

            {/* Background Mode PiP */}
            <button
              onClick={handleTogglePiP}
              title="Background Mode"
              className="p-2 rounded-lg transition-all"
              style={{
                background: pipActive ? 'var(--pecs-accent-dim)' : 'transparent',
                color: pipActive ? 'var(--pecs-accent)' : 'var(--pecs-text-muted)',
                border: pipActive ? '1px solid rgba(45,212,191,0.2)' : '1px solid transparent',
              }}
            >
              <Tv className="w-4 h-4" />
            </button>
          </div>
        </motion.header>

        {/* ═══════════════════════ MAIN CONTENT ═══════════════════════ */}
        <AnimatePresence mode="wait">
          {/* ── PRE-CONNECTION VIEW ── */}
          {isListening && (
            <motion.div
              key="pre-connection"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1 flex flex-col justify-center overflow-hidden"
            >
              {/* Tagline */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="mb-10 text-center max-w-2xl mx-auto"
              >
                <p className="text-xs font-semibold tracking-widest uppercase mb-3 inline-block px-3 py-1 rounded-full"
                  style={{ color: 'var(--pecs-accent)', background: 'var(--pecs-accent-dim)' }}>
                  PRIVATE EXCHANGE
                </p>
                <h2 className="text-3xl md:text-5xl font-bold text-white leading-tight mb-4">
                  Move it without leaving a trace.
                </h2>
                <p className="text-base text-gray-400">
                  A temporary bridge between the devices in front of you. E2E Encrypted.
                </p>
              </motion.div>

              {/* Two-column balanced grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center max-w-4xl mx-auto w-full">
                {/* Left: Pair card */}
                <motion.div
                   initial={{ opacity: 0, x: -20 }}
                   animate={{ opacity: 1, x: 0 }}
                   transition={{ duration: 0.5, delay: 0.2 }}
                >
                  <PairDeviceCard
                    roomCode={roomCode}
                    onShowQR={() => setShowQRModal(true)}
                    onJoin={handleJoinAnotherRoom}
                    onRandomize={handleRandomizeCode}
                    isWaitingForApproval={isWaitingForApproval}
                  />
                </motion.div>

                {/* Right: Send something placeholder */}
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: 0.3 }}
                  className="pecs-panel p-8 shadow-2xl h-full flex flex-col"
                  style={{ boxShadow: '0 20px 40px -10px rgba(0,0,0,0.5)' }}
                >
                  <h3 className="text-xl font-bold text-white mb-2">Send something</h3>
                  <p className="text-sm mb-8" style={{ color: 'var(--pecs-text-muted)' }}>
                    Pair a device first to start transferring files, links, or text securely across the room.
                  </p>
                  <div className="flex-1 flex items-center justify-center">
                    <DragDropZone onFileSelect={() => {}} disabled={true} />
                  </div>
                </motion.div>
              </div>
            </motion.div>
          )}

          {/* ── CONNECTED VIEW ── */}
          {isConnected && (
            <motion.div
              key="connected"
              initial={{ opacity: 0, scale: 0.98, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col flex-1 px-5 pb-5 overflow-y-auto"
            >
              <div className="pecs-connected-grid grid grid-cols-1 lg:grid-cols-3 gap-5 items-start flex-1 max-w-[1600px] mx-auto w-full">
                {/* Clipboard Panel */}
                <motion.section
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.05 }}
                  className="h-full"
                >
                  <div className="pecs-panel pecs-panel-glow h-full" style={{ minHeight: 460 }}>
                    <ClipboardPanel
                      items={clipboardItems}
                      onPasteItem={handleAddClipboardItem}
                      onClear={() => setClipboardItems([])}
                      disabled={false}
                    />
                  </div>
                </motion.section>

                {/* Messages Panel */}
                <motion.section
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.1 }}
                  className="h-full"
                >
                    <div className="pecs-panel pecs-panel-glow p-5 flex flex-col h-full" style={{ minHeight: 460 }}>
                      <ChatPanel
                        messages={messages}
                        onSend={handleSendChat}
                        disabled={false}
                      />
                    </div>
                  </motion.section>

                  {/* Send something Panel */}
                  <motion.section
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.15 }}
                    className="h-full"
                  >
                    <div className="pecs-panel pecs-panel-glow p-5 flex flex-col h-full" style={{ minHeight: 460 }}>
                      <h3 className="text-base font-semibold text-white mb-1 flex items-center">
                        <Shield className="w-4 h-4 mr-2" style={{ color: 'var(--pecs-accent)' }} />
                        Send something
                      </h3>
                    <p className="text-xs mb-5" style={{ color: 'var(--pecs-text-muted)' }}>
                      Everything is encrypted in your browser before it leaves.
                    </p>

                    <DragDropZone
                      onFileSelect={handleFileSelect}
                      disabled={isTransferring}
                    />

                    {/* Transfer progress */}
                    <AnimatePresence>
                      {isTransferring && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.3 }}
                          className="mt-4 rounded-xl p-4"
                          style={{ background: 'var(--pecs-bg)', border: '1px solid var(--pecs-border)' }}
                        >
                          <div className="flex justify-between text-xs mb-2"
                            style={{ color: 'var(--pecs-text-muted)' }}>
                            <span>
                              {transferProgress >= 99 && activeTransferRef.current.fileId
                                ? 'Awaiting peer acknowledgement…'
                                : 'Transferring…'}
                            </span>
                            <span>{Math.round(transferProgress)}%</span>
                          </div>
                          <div className="w-full rounded-full h-1.5"
                            style={{ background: 'var(--pecs-surface)' }}>
                            <motion.div
                              className="h-1.5 rounded-full"
                              style={{ background: 'var(--pecs-accent)' }}
                              initial={{ width: '0%' }}
                              animate={{ width: `${transferProgress}%` }}
                              transition={{ duration: 0.3 }}
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Success badges */}
                    <AnimatePresence>
                      {sentFileSuccess && !isTransferring && (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="mt-4 rounded-xl p-4 flex items-center space-x-3 text-sm"
                          style={{
                            background: 'rgba(34,197,94,0.08)',
                            border: '1px solid rgba(34,197,94,0.2)',
                            color: 'var(--pecs-success)',
                          }}
                        >
                          <CheckCircle className="w-5 h-5 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium">File sent &amp; acknowledged</p>
                            <p className="text-xs truncate mt-0.5 opacity-70">{sentFileSuccess.name}</p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <AnimatePresence>
                      {receivedFile && !isTransferring && (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="mt-4 rounded-xl p-4 flex items-center space-x-3 text-sm"
                          style={{
                            background: 'rgba(34,197,94,0.08)',
                            border: '1px solid rgba(34,197,94,0.2)',
                            color: 'var(--pecs-success)',
                          }}
                        >
                          <HardDrive className="w-5 h-5 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium">File received &amp; saved</p>
                            <p className="text-xs truncate mt-0.5 opacity-70">{receivedFile.name}</p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.section>
              </div>

              {/* Session data notice only in connected view */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-center mt-6 flex items-center justify-center space-x-2"
                style={{ color: 'var(--pecs-text-muted)', opacity: 0.6 }}
              >
                <Shield className="w-3 h-3" />
                <span className="text-[10px] font-semibold tracking-widest uppercase">
                  Session data lives in memory only
                </span>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ═══════════════════════ MODALS ═══════════════════════ */}
      <AnimatePresence>
        {showQRModal && (
          <QRPairingModal
            roomCode={currentRoom || roomCode}
            isConnected={isConnected}
            onJoin={(code) => { setShowQRModal(false); handleJoinAnotherRoom(code); }}
            onClose={() => setShowQRModal(false)}
          />
        )}
        
        {showDevicesModal && (
          <ConnectedDevicesModal 
            peers={connectedPeers}
            onKick={(peerId) => {
              handleDisconnection(peerId);
              if (connectedPeers.length <= 1) setShowDevicesModal(false);
            }}
            onClose={() => setShowDevicesModal(false)}
          />
        )}
      </AnimatePresence>

      {/* ═══════════════════════ iOS Tap to Sync ═══════════════════════ */}
      <AnimatePresence>
        {showIosSyncOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] backdrop-blur-md flex items-center justify-center cursor-pointer"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={async () => {
              const success = await flushPendingQueue();
              if (success) setShowIosSyncOverlay(false);
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="pecs-panel p-8 flex flex-col items-center max-w-sm mx-4 text-center shadow-2xl"
            >
              <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
                style={{ background: 'var(--pecs-accent-dim)' }}>
                <Zap className="w-8 h-8" style={{ color: 'var(--pecs-accent)' }} />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Tap to Sync</h3>
              <p className="text-sm" style={{ color: 'var(--pecs-text-muted)' }}>
                Safari requires a tap to paste the items received while you were away.
              </p>
              <button
                className="mt-8 px-6 py-3 rounded-xl font-semibold w-full transition-all"
                style={{ background: 'var(--pecs-accent)', color: 'var(--pecs-bg)' }}
              >
                Continue
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
