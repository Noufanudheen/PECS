import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Clipboard, Copy, Check, Image as ImageIcon, FileText, Trash2, ArrowDown } from 'lucide-react';

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
      className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6 backdrop-blur-sm flex flex-col h-full" 
      style={{ minHeight: 520 }}
      tabIndex={0}
      ref={pasteContainerRef}
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center">
            <Clipboard className="w-4 h-4 mr-2 text-indigo-400" />
            Session Clipboard
          </h2>
          <p className="text-xs text-zinc-500 font-mono mt-0.5">
            {items.length}/20 Items · Auto-Synced
          </p>
        </div>

        {items.length > 0 && (
          <button
            onClick={onClear}
            disabled={disabled}
            className="p-2 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
            title="Clear clipboard history"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Action Bar: Paste Button */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={handleManualPaste}
          disabled={disabled}
          className={`flex-1 py-3 px-4 rounded-xl font-medium text-sm flex items-center justify-center space-x-2 transition-all ${
            disabled
              ? 'bg-zinc-800/50 text-zinc-600 border border-zinc-800 cursor-not-allowed'
              : 'bg-indigo-600/90 hover:bg-indigo-500 text-white border border-indigo-500/30 shadow-lg shadow-indigo-500/10 active:scale-[0.99]'
          }`}
        >
          <Clipboard className="w-4 h-4" />
          <span>Sync Clipboard</span>
        </button>
      </div>
      
      {/* Fallback Text Input */}
      {showInput && !disabled && (
        <form onSubmit={handleTextSubmit} className="mb-4 flex space-x-2">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Paste or type snippet to sync..."
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 font-mono"
            autoFocus
          />
          <button
            type="submit"
            className="bg-zinc-800 hover:bg-zinc-700 text-white text-xs px-3 py-2 rounded-xl border border-zinc-700 font-medium"
          >
            Add
          </button>
        </form>
      )}

      {/* Clipboard Items Feed */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-3 chat-scroll">
        {items.length === 0 ? (
          <div className="h-full flex flex-col justify-center items-center text-center p-6 border border-dashed border-zinc-800/80 rounded-xl">
            <div className="w-10 h-10 rounded-full bg-zinc-800/50 flex items-center justify-center mb-3">
              <Clipboard className="w-5 h-5 text-zinc-600" />
            </div>
            <p className="text-sm font-medium text-zinc-400">Clipboard Empty</p>
            <p className="text-xs text-zinc-600 max-w-[200px] mt-1 leading-relaxed">
              Click <span className="text-zinc-400">Paste</span> above or press <kbd className="px-1 py-0.5 bg-zinc-800 rounded text-[10px] text-zinc-300 font-mono">Ctrl+V</kbd> anywhere to sync text or images across peers.
            </p>
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="group bg-zinc-950/80 border border-zinc-800/80 hover:border-indigo-500/30 rounded-xl p-3 transition-all relative overflow-hidden"
            >
              {/* Top metadata row */}
              <div className="flex items-center justify-between mb-2 text-[11px] text-zinc-500">
                <div className="flex items-center space-x-1.5 font-mono">
                  {item.itemType === 'image' ? (
                    <ImageIcon className="w-3.5 h-3.5 text-indigo-400" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  <span className="capitalize">{item.itemType}</span>
                </div>
                <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>

              {/* Item Content */}
              {item.itemType === 'image' ? (
                <div className="space-y-2">
                  <div className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900 flex justify-center max-h-48">
                    <img 
                      src={item.content} 
                      alt={item.title || 'Pasted image'} 
                      className="max-h-48 object-contain rounded-lg"
                    />
                  </div>
                  <div className="flex justify-between items-center text-xs pt-1">
                    <span className="text-zinc-400 text-[11px] font-mono truncate max-w-[100px]">{item.title || 'Image Snippet'}</span>
                    <div className="flex items-center space-x-1.5">
                      <button
                        onClick={() => handleCopyImage(item.id, item.content)}
                        className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center space-x-1 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 rounded-lg px-2 py-0.5 transition-colors"
                      >
                        {copiedId === item.id ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span className="text-emerald-400 text-[11px]">Copied!</span>
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
                        className="text-zinc-400 hover:text-white font-medium text-[11px] flex items-center space-x-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-2 py-0.5 transition-colors"
                      >
                        <ArrowDown className="w-3 h-3" />
                        <span>Save</span>
                      </a>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <pre className="text-xs text-zinc-200 font-mono whitespace-pre-wrap break-words bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800/60 max-h-36 overflow-y-auto chat-scroll leading-relaxed">
                    {item.content}
                  </pre>
                  
                  <button
                    onClick={() => handleCopyText(item.id, item.content)}
                    className="mt-2 text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center space-x-1 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 rounded-lg px-2.5 py-1 transition-colors ml-auto"
                  >
                    {copiedId === item.id ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied!</span>
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
            </div>
          ))
        )}
      </div>
    </div>
  );
}
