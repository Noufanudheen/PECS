import React from 'react';
import { UserPlus, Check, X } from 'lucide-react';
import { motion } from 'motion/react';

export default function ConnectionRequest({ request, onAccept, onDecline }) {
  if (!request) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] w-full max-w-sm px-4"
    >
      <div 
        className="rounded-2xl p-4 shadow-2xl flex items-center justify-between"
        style={{ 
          background: 'var(--pecs-surface)', 
          border: '1px solid var(--pecs-accent)',
          boxShadow: '0 10px 40px -10px rgba(45,212,191,0.2)'
        }}
      >
        <div className="flex items-center space-x-3 min-w-0 flex-1">
          <div 
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--pecs-accent-dim)' }}
          >
            <UserPlus className="w-5 h-5" style={{ color: 'var(--pecs-accent)' }} />
          </div>
          <div className="min-w-0 pr-2">
            <h4 className="text-sm font-semibold text-white truncate">Device wants to connect</h4>
            <p className="text-xs truncate" style={{ color: 'var(--pecs-text-muted)' }}>
              {request.deviceName || 'Unknown device'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 flex-shrink-0">
          <button
            onClick={() => onDecline(request.peerId)}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{ 
              background: 'rgba(239,68,68,0.1)', 
              color: 'var(--pecs-error, #ef4444)' 
            }}
            title="Decline"
          >
            <X className="w-4 h-4" />
          </button>
          
          <button
            onClick={() => onAccept(request.peerId)}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-lg"
            style={{ 
              background: 'var(--pecs-accent)', 
              color: 'var(--pecs-bg)' 
            }}
            title="Accept"
          >
            <Check className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
