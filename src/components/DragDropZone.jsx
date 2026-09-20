import React, { useState, useRef } from 'react';
import { UploadCloud } from 'lucide-react';
import { motion } from 'motion/react';

export default function DragDropZone({ onFileSelect, disabled = false }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileSelect(e.dataTransfer.files[0]);
      e.dataTransfer.clearData();
    }
  };

  const handleClick = () => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelect(e.target.files[0]);
    }
  };

  return (
    <motion.div
      whileHover={!disabled ? { scale: 1.01 } : {}}
      whileTap={!disabled ? { scale: 0.99 } : {}}
      className={`
        border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer
        flex flex-col items-center justify-center transition-all duration-300
        ${isDragging
          ? 'border-[var(--pecs-accent)] bg-[var(--pecs-accent-glow)]'
          : 'border-[var(--pecs-border)] hover:border-[var(--pecs-border-hover)]'
        }
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
      `}
      style={{
        background: isDragging ? 'var(--pecs-accent-glow)' : 'var(--pecs-bg)',
        minHeight: 180,
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileInput} 
        className="hidden" 
      />
      <motion.div
        animate={isDragging ? { y: -4, scale: 1.1 } : { y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <UploadCloud
          className="w-10 h-10 mb-3"
          style={{ color: isDragging ? 'var(--pecs-accent)' : 'var(--pecs-text-muted)' }}
        />
      </motion.div>
      <h3 className="text-white font-medium text-sm mb-1">Drop files here</h3>
      <p className="text-xs" style={{ color: 'var(--pecs-text-muted)' }}>
        or browse from this device
      </p>
    </motion.div>
  );
}
