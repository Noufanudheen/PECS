import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Clipboard, Copy, Check, Image as ImageIcon, FileText, Trash2, ArrowDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function ClipboardPanel({ items = [], onPasteItem, onClear, disabled = false }) {
  const [copiedId, setCopiedId] = useState(null);
  const [textInput, setTextInput] = useState('');
  const [showInput, setShowInput] = useState(false);
  const pasteContainerRef = useRef(null);

  // Helper to trigger copy to clipboard with feedback indicator
  const handleCopyText = async (id, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.warn('Clipboard write failed, using fallback:', err);
    }
  };

  // Helper to process ClipboardItems from navigator.clipboard API or onPaste events
  const handleManualPaste = async () => {
    if (disabled) return;

    try {
      // 1. Try modern Async Clipboard API
      if (navigator.clipboard && navigator.clipboard.read) {
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
          // Check for image types
          const imageType = item.types.find(type => type.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            const reader = new FileReader();
            reader.onload = () => {
              onPasteItem({
                id: 'cb_' + Date.now().toString(36) + Math.random().toString(36).slice(2),
                itemType: 'image',
                content: reader.result,
                title: `Image (${(blob.size / 1024).toFixed(1)} KB)`,
                timestamp: Date.now()
              });
            };
            reader.readAsDataURL(blob);
            return;
          }
          
          // Check for text types
          if (item.types.includes('text/plain')) {
            const blob = await item.getType('text/plain');
            const text = await blob.text();
            if (text && text.trim()) {
              onPasteItem({
                id: 'cb_' + Date.now().toString(36) + Math.random().toString(36).slice(2),
                itemType: 'text',
                content: text,
                timestamp: Date.now()
              });
              return;
            }
          }
        }
      }

      // 2. Fallback to readText if read() is blocked or unsupported
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          onPasteItem({
            id: 'cb_' + Date.now().toString(36) + Math.random().toString(36).slice(2),
            itemType: 'text',
            content: text,
            timestamp: Date.now()
          });
          return;
        }
      }
    } catch (e) {
      console.warn('Direct clipboard read API unavailable/denied:', e);
      // Toggle manual paste input field if system clipboard permission prompt was denied
      setShowInput(prev => !prev);
    }
  };

  // Process text input form submission fallback
  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (!textInput.trim() || disabled) return;
    onPasteItem({
      id: 'cb_' + Date.now().toString(36) + Math.random().toString(36).slice(2),
      itemType: 'text',
      content: textInput.trim(),
      timestamp: Date.now()
    });
    setTextInput('');
    setShowInput(false);
  };

  // Handle global paste events inside component
  const handlePasteEvent = useCallback((e) => {
    if (disabled) return;

    // Ignore global paste handler when user is focused in a text field, input, textarea or chat box
    const target = e.target;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('input, textarea, [contenteditable="true"]'))
    ) {
      return;
    }

    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // Check for pasted images first
    if (clipboardData.items) {
      for (const item of clipboardData.items) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = () => {
              onPasteItem({
                id: 'cb_' + Date.now().toString(36) + Math.random().toString(36).slice(2),
                itemType: 'image',
                content: reader.result,
                title: `Pasted Image (${(blob.size / 1024).toFixed(1)} KB)`,
                timestamp: Date.now()
              });
            };
            reader.readAsDataURL(blob);
            e.preventDefault();
            return;
          }
        }
      }
    }

    // Handle pasted text
    const text = clipboardData.getData('text');
    if (text && text.trim()) {
      onPasteItem({
        id: 'cb_' + Date.now().toString(36) + Math.random().toString(36).slice(2),
        itemType: 'text',
        content: text,
        timestamp: Date.now()
      });
      e.preventDefault();
    }
  }, [disabled, onPasteItem]);

  useEffect(() => {
    document.addEventListener('paste', handlePasteEvent);
    return () => {
      document.removeEventListener('paste', handlePasteEvent);
    };
  }, [handlePasteEvent]);

  // Helper to copy image to clipboard
  const handleCopyImage = async (id, dataUrl) => {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      let pngBlob = blob;

      if (blob.type !== 'image/png') {
        const img = new Image();
        img.src = dataUrl;
        await new Promise(resolve => (img.onload = resolve));
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      }

      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': pngBlob })
        ]);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    } catch (err) {
      console.warn('Clipboard image write failed:', err);
    }
  };

  return (
    <div
      className="pecs-panel pecs-panel-glow p-5 flex flex-col h-full"
      style={{ minHeight: 460 }}
      tabIndex={0}
      ref={pasteContainerRef}
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center">
            <Clipboard className="w-4 h-4 mr-2" style={{ color: 'var(--pecs-accent)' }} />
            Clipboard
          </h2>
          <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--pecs-text-muted)' }}>
            {items.length}/20 Items · Auto-Synced
          </p>
        </div>

        {items.length > 0 && (
          <button
            onClick={onClear}
            disabled={disabled}
            className="p-2 rounded-lg transition-colors"
            style={{ color: 'var(--pecs-text-muted)' }}
            title="Clear clipboard history"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Action Bar: Paste Button */}
      <div className="mb-4">
        <motion.button
          onClick={handleManualPaste}
          disabled={disabled}
          whileHover={!disabled ? { scale: 1.01 } : {}}
          whileTap={!disabled ? { scale: 0.98 } : {}}
          className={`w-full py-3 px-4 rounded-xl font-semibold text-sm flex items-center justify-center space-x-2 transition-all ${
            disabled ? 'opacity-40 cursor-not-allowed' : ''
          }`}
          style={{
            background: disabled ? 'var(--pecs-surface)' : 'var(--pecs-accent)',
            color: disabled ? 'var(--pecs-text-muted)' : 'var(--pecs-bg)',
            border: disabled ? '1px solid var(--pecs-border)' : 'none',
          }}
        >
          <Clipboard className="w-4 h-4" />
          <span>Paste</span>
        </motion.button>
      </div>
      
      {/* Fallback Text Input */}
      <AnimatePresence>
        {showInput && !disabled && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            onSubmit={handleTextSubmit}
            className="mb-4 flex space-x-2"
          >
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Paste or type snippet to sync..."
              className="pecs-input flex-1 text-xs font-mono"
              autoFocus
            />
            <button
              type="submit"
              className="px-3 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{ background: 'var(--pecs-accent)', color: 'var(--pecs-bg)' }}
            >
              Add
            </button>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Clipboard Items Feed */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-3 chat-scroll">
        {items.length === 0 ? (
          <div className="h-full flex flex-col justify-center items-center text-center p-6 border border-dashed rounded-xl"
            style={{ borderColor: 'var(--pecs-border)' }}>
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4 }}
              className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
              style={{ background: 'var(--pecs-surface)' }}
            >
              <Clipboard className="w-5 h-5" style={{ color: 'var(--pecs-text-muted)' }} />
            </motion.div>
            <p className="text-sm font-medium" style={{ color: 'var(--pecs-text-dim)' }}>
              Clipboard Empty
            </p>
            <p className="text-xs max-w-[200px] mt-1 leading-relaxed" style={{ color: 'var(--pecs-text-muted)' }}>
              Click <span className="text-white">Paste</span> above or press{' '}
              <kbd className="px-1 py-0.5 rounded text-[10px] text-white font-mono"
                style={{ background: 'var(--pecs-surface)' }}>
                Ctrl+V
              </kbd>{' '}
              anywhere to sync.
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: -12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="group rounded-xl p-3 transition-all relative overflow-hidden"
                style={{
                  background: 'var(--pecs-bg)',
                  border: '1px solid var(--pecs-border)',
                }}
              >
                {/* Top metadata row */}
                <div className="flex items-center justify-between mb-2 text-[11px]"
                  style={{ color: 'var(--pecs-text-muted)' }}>
                  <div className="flex items-center space-x-1.5 font-mono">
                    {item.itemType === 'image' ? (
                      <ImageIcon className="w-3.5 h-3.5" style={{ color: 'var(--pecs-accent)' }} />
                    ) : (
                      <FileText className="w-3.5 h-3.5" style={{ color: 'var(--pecs-success)' }} />
                    )}
                    <span className="capitalize">{item.itemType}</span>
                  </div>
                  <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>

                {/* Item Content */}
                {item.itemType === 'image' ? (
                  <div className="space-y-2">
                    <div className="rounded-lg overflow-hidden flex justify-center max-h-48"
                      style={{ border: '1px solid var(--pecs-border)', background: 'var(--pecs-surface)' }}>
                      <img 
                        src={item.content} 
                        alt={item.title || 'Pasted image'} 
                        className="max-h-48 object-contain rounded-lg"
                      />
                    </div>
                    <div className="flex justify-between items-center text-xs pt-1">
                      <span className="text-[11px] font-mono truncate max-w-[100px]"
                        style={{ color: 'var(--pecs-text-muted)' }}>
                        {item.title || 'Image Snippet'}
                      </span>
                      <div className="flex items-center space-x-1.5">
                        <button
                          onClick={() => handleCopyImage(item.id, item.content)}
                          className="text-xs font-medium flex items-center space-x-1 rounded-lg px-2 py-0.5 transition-colors"
                          style={{
                            color: 'var(--pecs-accent)',
                            background: 'var(--pecs-accent-dim)',
                            border: '1px solid rgba(45,212,191,0.2)',
                          }}
                        >
                          {copiedId === item.id ? (
                            <>
                              <Check className="w-3 h-3" style={{ color: 'var(--pecs-success)' }} />
                              <span className="text-[11px]" style={{ color: 'var(--pecs-success)' }}>Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span className="text-[11px]">Copy</span>
                            </>
                          )}
                        </button>
                        <a
                          href={item.content}
                          download={`pasted-image-${item.id}.png`}
                          className="font-medium text-[11px] flex items-center space-x-1 rounded-lg px-2 py-0.5 transition-colors"
                          style={{
                            color: 'var(--pecs-text-dim)',
                            background: 'var(--pecs-surface)',
                            border: '1px solid var(--pecs-border)',
                          }}
                        >
                          <ArrowDown className="w-3 h-3" />
                          <span>Save</span>
                        </a>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <pre
                      className="text-xs font-mono whitespace-pre-wrap break-words p-2.5 rounded-lg max-h-36 overflow-y-auto chat-scroll leading-relaxed"
                      style={{
                        color: 'var(--pecs-text)',
                        background: 'var(--pecs-surface)',
                        border: '1px solid var(--pecs-border)',
                      }}
                    >
                      {item.content}
                    </pre>
                    
                    <button
                      onClick={() => handleCopyText(item.id, item.content)}
                      className="mt-2 text-xs font-medium flex items-center space-x-1 rounded-lg px-2.5 py-1 transition-colors ml-auto"
                      style={{
                        color: 'var(--pecs-accent)',
                        background: 'var(--pecs-accent-dim)',
                        border: '1px solid rgba(45,212,191,0.2)',
                      }}
                    >
                      {copiedId === item.id ? (
                        <>
                          <Check className="w-3 h-3" style={{ color: 'var(--pecs-success)' }} />
                          <span style={{ color: 'var(--pecs-success)' }}>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy Text</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
