// Background activity helper using Picture-in-Picture (PiP) and Screen Wake Lock API

let canvasEl = null;
let ctx = null;
let videoEl = null;
let wakeLock = null;
let audioCtx = null;
let isPiPActive = false;

/**
 * Renders live P2P status on canvas stream for PiP video
 */
function drawCanvas(status = 'disconnected', progress = 0, room = '', isTransferring = false) {
  if (!ctx || !canvasEl) return;

  // Dark background
  ctx.fillStyle = '#0a0a0b';
  ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);

  // Border / Card
  ctx.strokeStyle = '#27272a';
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, canvasEl.width - 8, canvasEl.height - 8);

  // Title
  ctx.fillStyle = '#f4f4f5';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('⚡ PECS P2P Tunnel', 16, 28);

  // Status dot & text
  const statusColor = status === 'connected' ? '#34d399' : (status === 'waiting' || status === 'connecting' ? '#fbbf24' : '#71717a');
  ctx.fillStyle = statusColor;
  ctx.beginPath();
  ctx.arc(20, 52, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#d4d4d8';
  ctx.font = '13px sans-serif';
  ctx.fillText(`Status: ${status.toUpperCase()} ${room ? `(${room})` : ''}`, 32, 56);

  // Transfer progress bar if transferring
  if (isTransferring || progress > 0) {
    ctx.fillStyle = '#a1a1aa';
    ctx.font = '12px sans-serif';
    ctx.fillText(`Transferring: ${Math.round(progress)}%`, 16, 84);

    // Progress track
    ctx.fillStyle = '#27272a';
    ctx.fillRect(16, 92, canvasEl.width - 32, 10);

    // Progress bar fill
    ctx.fillStyle = '#6366f1';
    ctx.fillRect(16, 92, (canvasEl.width - 32) * (progress / 100), 10);
  } else {
    ctx.fillStyle = '#71717a';
    ctx.font = '12px sans-serif';
    ctx.fillText('Direct P2P Local Data Tunnel Active', 16, 84);
  }

  // Footer note
  ctx.fillStyle = '#52525b';
  ctx.font = '10px monospace';
  ctx.fillText('Background Keep-Alive Active', 16, 124);
}

/**
 * Initializes the silent audio context and video element for PiP stream
 */
export function setupBackgroundKeepAlive() {
  if (typeof document === 'undefined') return;

  if (!canvasEl) {
    canvasEl = document.createElement('canvas');
    canvasEl.width = 300;
    canvasEl.height = 140;
    ctx = canvasEl.getContext('2d');
    drawCanvas('disconnected', 0, '', false);
  }

  if (!videoEl) {
    videoEl = document.createElement('video');
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.style.cssText = 'position: absolute; opacity: 0; pointer-events: none; width: 1px; height: 1px;';
    document.body.appendChild(videoEl);

    // iOS Safari: muted=true tells iOS this isn't real media and PiP gets suspended.
    // Instead, set near-zero volume so iOS treats it as an active media session.
    const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent);
    videoEl.muted = !isIOS;
    videoEl.volume = isIOS ? 0.001 : 1;

    // Capture canvas stream into video element
    if (canvasEl.captureStream) {
      const stream = canvasEl.captureStream(10); // 10 FPS
      videoEl.srcObject = stream;
      videoEl.play().catch(() => {});
    }

    videoEl.addEventListener('leavepictureinpicture', () => {
      isPiPActive = false;
    });
  }

  // Start audio context to prevent tab throttling.
  // On Android: route through MediaStreamDestination so the OS registers an active
  // audio session (same background exemption as music apps).
  // On desktop: connect directly to destination as usual.
  try {
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      gain.gain.value = 0.0001; // Silent / inaudible
      osc.connect(gain);

      // Route to MediaStreamDestination for Android OS media session registration
      const mediaStreamDest = audioCtx.createMediaStreamDestination();
      gain.connect(mediaStreamDest);
      gain.connect(audioCtx.destination); // Desktop keep-alive too

      // Attach to a hidden <audio> element — this is what Android OS watches
      const silentAudio = document.createElement('audio');
      silentAudio.srcObject = mediaStreamDest.stream;
      silentAudio.style.cssText = 'position: absolute; opacity: 0; pointer-events: none; width: 1px; height: 1px;';
      document.body.appendChild(silentAudio);
      silentAudio.play().catch(() => {});

      osc.start();
    } else if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  } catch (e) {
    console.warn('[BackgroundMode] Web Audio Context setup ignored:', e);
  }
}

/**
 * Updates the PiP canvas content whenever state changes
 */
export function updateBackgroundPiPState(status, progress, room, isTransferring) {
  drawCanvas(status, progress, room, isTransferring);
}

/**
 * Toggles Picture-in-Picture (PiP) window for background activity
 */
export async function togglePictureInPicture() {
  setupBackgroundKeepAlive();

  if (!document.pictureInPictureEnabled) {
    alert('Picture-in-Picture is not supported in this browser.');
    return false;
  }

  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      isPiPActive = false;
      return false;
    } else if (videoEl) {
      await videoEl.play();
      await videoEl.requestPictureInPicture();
      isPiPActive = true;
      return true;
    }
  } catch (err) {
    console.error('[BackgroundMode] Failed to toggle PiP:', err);
    return false;
  }
  return false;
}

export function isPiPEnabled() {
  return isPiPActive || !!document.pictureInPictureElement;
}

/**
 * Requests Screen Wake Lock during active transfers
 */
export async function requestWakeLock() {
  if ('wakeLock' in navigator && !wakeLock) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('[BackgroundMode] Screen Wake Lock acquired.');
      wakeLock.addEventListener('release', () => {
        console.log('[BackgroundMode] Screen Wake Lock released.');
        wakeLock = null;
      });
    } catch (err) {
      console.warn('[BackgroundMode] Wake Lock request failed:', err);
    }
  }
}

/**
 * Releases Screen Wake Lock
 */
export function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

/**
 * Attaches a one-time user interaction listener to start the background keep-alive
 * specifically for mobile devices to prevent aggressive background suspension.
 */
export function initMobileBackgroundSound() {
  if (typeof document === 'undefined') return;
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (!isMobile) return;

  const unlockAudio = () => {
    setupBackgroundKeepAlive();
    // Check if the context was successfully created and running
    if (audioCtx && audioCtx.state === 'running') {
      document.removeEventListener('touchstart', unlockAudio, true);
      document.removeEventListener('click', unlockAudio, true);
      document.removeEventListener('touchend', unlockAudio, true);
      console.log('[BackgroundMode] Mobile background audio unlocked');
    }
  };

  document.addEventListener('touchstart', unlockAudio, true);
  document.addEventListener('click', unlockAudio, true);
  document.addEventListener('touchend', unlockAudio, true);
}

