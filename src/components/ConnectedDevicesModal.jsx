import React from 'react';
import { Lock, X, Globe, Wifi, Monitor, Smartphone, CheckCircle, ShieldOff } from 'lucide-react';
import { motion } from 'motion/react';

export default function ConnectedDevicesModal({ peers, onKick, onClose }) {
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
        layoutId="connected-devices-modal"
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 20 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md rounded-2xl overflow-hidden flex flex-col max-h-[80vh]"
        style={{ background: 'var(--pecs-card)', border: '1px solid var(--pecs-border)' }}
      >
        {/* Header */}
        <div className="p-5 pb-4 border-b" style={{ borderColor: 'var(--pecs-border)' }}>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-white flex items-center">
              <Lock className="w-5 h-5 mr-2" style={{ color: 'var(--pecs-accent)' }} />
              Peer Connections
            </h2>
            <button
              onClick={onClose}
              className="p-1 rounded-lg transition-colors"
              style={{ color: 'var(--pecs-text-muted)' }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--pecs-text-muted)' }}>
            Manage active end-to-end encrypted connections.
          </p>
        </div>

        {/* Content list */}
        <div className="p-5 overflow-y-auto space-y-3">
          {peers.length === 0 ? (
            <div className="text-center py-8">
              <ShieldOff className="w-8 h-8 mx-auto mb-3 opacity-30" style={{ color: 'var(--pecs-text-muted)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--pecs-text-muted)' }}>No peers connected</p>
            </div>
          ) : (
            peers.map(peer => {
              const isMobile = peer.deviceName?.toLowerCase().includes('mobile') || peer.deviceName?.toLowerCase().includes('iphone') || peer.deviceName?.toLowerCase().includes('android');
              return (
                <div 
                  key={peer.id}
                  className="rounded-xl p-3.5 flex items-center justify-between"
                  style={{ background: 'var(--pecs-surface)', border: '1px solid var(--pecs-border)' }}
                >
                  <div className="flex items-center space-x-3 min-w-0 pr-3">
                    <div 
                      className="w-10 h-10 rounded-full flex flex-col items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--pecs-bg)' }}
                    >
                      {isMobile ? (
                        <Smartphone className="w-5 h-5" style={{ color: 'var(--pecs-text-muted)' }} />
                      ) : (
                        <Monitor className="w-5 h-5" style={{ color: 'var(--pecs-text-muted)' }} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {peer.deviceName || 'Unknown Device'}
                      </p>
                      <div className="flex items-center mt-1 space-x-2 text-[10px]">
                        <span className="font-mono bg-black/20 px-1.5 py-0.5 rounded" style={{ color: 'var(--pecs-text-muted)' }}>
                          {peer.id.slice(0, 8)}
                        </span>
                        {peer.isLocal ? (
                          <span className="flex items-center text-green-400">
                            <Wifi className="w-3 h-3 mr-1" /> Local
                          </span>
                        ) : (
                          <span className="flex items-center text-yellow-400">
                            <Globe className="w-3 h-3 mr-1" /> Relay
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => onKick(peer.id)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                    style={{ 
                      color: 'var(--pecs-error, #ef4444)',
                      background: 'rgba(239,68,68,0.1)'
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
