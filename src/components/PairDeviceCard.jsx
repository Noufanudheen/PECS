import React, { useState, useCallback } from 'react';
import { Copy, Check, QrCode, LogIn, RefreshCw, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function PairDeviceCard({ roomCode, onShowQR, onJoin, onRandomize, isWaitingForApproval }) {
  const [copied, setCopied] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [manualCode, setManualCode] = useState('');

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = roomCode;
      ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [roomCode]);

  const handleManualJoin = (e) => {
    e.preventDefault();
    const code = manualCode.trim();
    if (code) {
      onJoin(code);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="pecs-panel overflow-hidden w-full max-w-sm mx-auto shadow-2xl"
      style={{ boxShadow: '0 20px 40px -10px rgba(0,0,0,0.5)' }}
    >
      <div className="p-6">
        <h3 className="text-lg font-bold text-white mb-2">Your room code</h3>
        <p className="text-xs mb-5 leading-relaxed" style={{ color: 'var(--pecs-text-muted)' }}>
          Share this code with another device to establish an encrypted connection.
        </p>

        {/* Room Code Display */}
        <div 
          className="flex items-center justify-between mb-5 rounded-xl px-4 py-3"
          style={{ background: 'var(--pecs-bg)', border: '1px solid var(--pecs-border)' }}
        >
          <span className="font-mono text-2xl font-bold tracking-widest text-white">
            {roomCode}
          </span>
          <button
            onClick={onRandomize}
            className="p-2 rounded-lg transition-colors hover:bg-white/5"
            style={{ color: 'var(--pecs-text-muted)' }}
            title="Generate new code"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleCopy}
            className="flex-1 flex items-center justify-center space-x-2 py-3 px-4 rounded-xl text-sm font-semibold transition-all hover:brightness-110"
            style={{
              background: 'var(--pecs-surface)',
              border: '1px solid var(--pecs-border)',
              color: 'var(--pecs-text)',
            }}
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" style={{ color: 'var(--pecs-success)' }} />
                <span style={{ color: 'var(--pecs-success)' }}>Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copy code</span>
              </>
            )}
          </button>

          <button
            onClick={onShowQR}
            className="flex-1 flex items-center justify-center space-x-2 py-3 px-4 rounded-xl text-sm font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
            style={{
              background: 'var(--pecs-accent)',
              color: 'var(--pecs-bg)',
            }}
          >
            <QrCode className="w-4 h-4" />
            <span>Show QR</span>
          </button>
        </div>
      </div>

      {/* Join Another Room Section */}
      <div 
        className="border-t transition-colors"
        style={{ borderColor: 'var(--pecs-border)', background: showJoin ? 'var(--pecs-bg)' : 'transparent' }}
      >
        <button
          onClick={() => setShowJoin(!showJoin)}
          className="w-full px-6 py-4 flex items-center justify-between text-sm font-medium transition-colors hover:bg-white/5"
          style={{ color: showJoin ? 'var(--pecs-text)' : 'var(--pecs-text-muted)' }}
        >
          <div className="flex items-center space-x-2">
            <LogIn className="w-4 h-4" />
            <span>Join another room</span>
          </div>
          {showJoin ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        <AnimatePresence>
          {showJoin && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <form onSubmit={handleManualJoin} className="px-6 pb-6 pt-2 flex gap-3">
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                  placeholder="Enter code..."
                  className="pecs-input flex-1 font-mono text-sm uppercase tracking-wider"
                  maxLength={9}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!manualCode.trim() || isWaitingForApproval}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center min-w-[80px]"
                  style={{
                    background: 'var(--pecs-surface)',
                    color: 'var(--pecs-text)',
                    border: '1px solid var(--pecs-border)',
                  }}
                >
                  {isWaitingForApproval ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Join'}
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
