import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { ArrowLeft, QrCode, Camera, Keyboard, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function QRPairingModal({ roomCode, isConnected, initialMode = 'show', onJoin, onClose }) {
  const [mode, setMode] = useState(initialMode); // 'show' | 'scan'
  const [scanStatus, setScanStatus] = useState('idle');
  const [scannedCode, setScannedCode] = useState('');
  const [isDesktop, setIsDesktop] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const scannerRef = useRef(null);

  useEffect(() => {
    // Only trust userAgent for mobile detection to avoid touchscreen PCs masking as mobile
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    setIsDesktop(!isMobile);
    if (!isMobile) setShowInput(true);

    if (initialMode === 'scan' && isMobile) {
      startScanner();
    }
    
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, []);

  const startScanner = async () => {
    setScanStatus('scanning');
    await new Promise(r => setTimeout(r, 400));
    try {
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
        (decodedText) => {
          const match = decodedText.match(/([A-Z0-9]{4}-[A-Z0-9]{4})/);
          if (match) {
            const extractedCode = match[1];
            setScannedCode(extractedCode);
            setScanStatus('found');
            scanner.stop().catch(() => {});
            scannerRef.current = null;
            setTimeout(() => {
              onJoin(extractedCode);
              onClose();
            }, 800);
          }
        },
        () => {}
      );
    } catch (err) {
      console.error('QR Scanner failed to start:', err);
      setScanStatus('idle');
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      await scannerRef.current.stop().catch(() => {});
      scannerRef.current = null;
    }
    setScanStatus('idle');
  };

  const handleModeSwitch = async (newMode) => {
    if (newMode === 'scan' && mode !== 'scan') {
      setMode('scan');
      await startScanner();
    } else if (newMode === 'show') {
      await stopScanner();
      setMode('show');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        layoutId="qr-modal"
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 20 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md rounded-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--pecs-card)', border: '1px solid var(--pecs-border)' }}
      >
        {/* Header */}
        <div className="p-5 pb-2">
          <button
            onClick={onClose}
            className="flex items-center space-x-1.5 text-sm font-medium mb-4 transition-colors"
            style={{ color: 'var(--pecs-accent)' }}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          <h2 className="text-2xl font-bold text-white mb-1.5">
            {mode === 'show' ? (isConnected ? 'Share this room code' : 'Share or join') : 'Scan a room code'}
          </h2>
          <p style={{ color: 'var(--pecs-text-muted)' }} className="text-sm">
            {mode === 'show'
              ? (isConnected ? 'Point a camera at this code to invite another device.' : 'Point a camera at this code, or enter one below.')
              : 'Point your camera at the QR code on the other device.'}
          </p>
        </div>

        {/* QR Content */}
        <div className="px-5 py-4">
          <AnimatePresence mode="wait">
            {mode === 'show' ? (
              <motion.div
                key="show"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col items-center"
              >
                <div
                  className="rounded-3xl p-6 flex items-center justify-center shadow-lg"
                  style={{ background: '#ffffff', border: '4px solid #f1f5f9' }}
                >
                  <QRCodeSVG
                    value={`${window.location.origin}/#${roomCode || 'PECS'}`}
                    size={240}
                    level="Q"
                    bgColor="#ffffff"
                    fgColor="#0f172a"
                    includeMargin={false}
                  />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="scan"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col items-center"
              >
                <div
                  className="rounded-2xl overflow-hidden w-full relative"
                  style={{ background: 'var(--pecs-surface)', minHeight: 280 }}
                >
                  <div id="qr-reader" className="w-full" />
                  {scanStatus === 'scanning' && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="text-center">
                         <p className="text-2xl font-bold" style={{ color: 'var(--pecs-accent)' }}>SCAN</p>
                         <p className="text-sm mt-1" style={{ color: 'var(--pecs-text-muted)' }}>Searching for a code</p>
                      </div>
                    </div>
                  )}
                  {scanStatus === 'found' && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ background: 'rgba(11, 17, 32, 0.9)' }}
                    >
                      <div className="text-center">
                        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--pecs-accent-dim)' }}>
                          <QrCode className="w-8 h-8" style={{ color: 'var(--pecs-accent)' }} />
                        </div>
                        <p className="text-white font-semibold text-lg">Code Found!</p>
                        <p className="font-mono text-sm mt-1" style={{ color: 'var(--pecs-accent)' }}>{scannedCode}</p>
                      </div>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 space-y-4">
          <div>
            <p className="text-xs font-semibold tracking-widest uppercase mb-2" style={{ color: 'var(--pecs-text-muted)' }}>YOUR CODE:</p>
            <div className="rounded-xl px-4 py-2.5 inline-block font-mono text-lg font-bold tracking-wider" style={{ background: 'var(--pecs-surface)', color: 'var(--pecs-text)' }}>
              {roomCode || '----'}
            </div>
          </div>

          {/* Action Row */}
          {!isConnected && (
            <div className="flex gap-3 h-14">
              {!isDesktop && (
                <motion.button
                layout
                onClick={() => {
                  if (showInput) {
                    setShowInput(false);
                    // Also switch back to 'show' mode if we were scanning? User didn't ask, but it makes sense
                  } else {
                    handleModeSwitch(mode === 'show' ? 'scan' : 'show');
                  }
                }}
                className="flex items-center justify-center rounded-xl font-semibold text-sm transition-all overflow-hidden whitespace-nowrap"
                style={{
                  flex: showInput ? '0 0 3.5rem' : '1',
                  background: 'var(--pecs-surface)',
                  color: 'var(--pecs-text)',
                  border: '1px solid var(--pecs-border)',
                }}
              >
                <AnimatePresence mode="wait">
                  {showInput ? (
                    <motion.div key="icon" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      {mode === 'show' ? <Camera className="w-5 h-5 flex-shrink-0" /> : <QrCode className="w-5 h-5 flex-shrink-0" />}
                    </motion.div>
                  ) : (
                    <motion.div key="text" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center space-x-2.5">
                      <span>{mode === 'show' ? 'Scan QR' : 'Show QR'}</span>
                      {mode === 'show' ? <Camera className="w-5 h-5" /> : <QrCode className="w-5 h-5" />}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>
            )}

            <motion.div
              layout
              className="flex rounded-xl overflow-hidden"
              style={{
                flex: showInput || isDesktop ? '1' : '0 0 3.5rem',
                background: 'var(--pecs-surface)',
                border: '1px solid var(--pecs-border)',
              }}
            >
              {(!showInput && !isDesktop) ? (
                <button
                  onClick={() => {
                    setShowInput(true);
                    if (mode === 'scan') handleModeSwitch('show');
                  }}
                  className="w-full h-full flex items-center justify-center hover:bg-white/5 transition-colors"
                  style={{ color: 'var(--pecs-text)' }}
                  title="Enter code manually"
                >
                  <Keyboard className="w-5 h-5" />
                </button>
              ) : (
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    if(manualCode.trim()) {
                      onJoin(manualCode);
                      onClose();
                    }
                  }} 
                  className="w-full h-full flex items-center p-1.5"
                >
                  <input
                    type="text"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                    placeholder="Enter code"
                    className="flex-1 bg-transparent border-none outline-none text-sm font-mono uppercase px-3 w-full min-w-0"
                    style={{ color: 'var(--pecs-text)' }}
                    maxLength={9}
                  />
                  <button
                    type="submit"
                    disabled={!manualCode.trim()}
                    className="px-4 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 h-full"
                    style={{ background: 'var(--pecs-accent)', color: 'var(--pecs-bg)' }}
                  >
                    Join
                  </button>
                </form>
              )}
            </motion.div>
          </div>
          )}

          <p className="text-xs text-center" style={{ color: 'var(--pecs-text-muted)' }}>
            Codes are short-lived and never stored on the server.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}
