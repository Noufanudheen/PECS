import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, Copy, Check, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function ChatPanel({ messages, onSend, disabled }) {
  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput('');
    inputRef.current?.focus();
  };

  const handleCopyText = async (id, text) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId(null);
      }, 1500);
    } catch (err) {
      console.warn('Failed to copy chat message:', err);
    }
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Parses URLs in chat message text and renders them as clickable links that open in a new tab
  const renderMessageContent = (text, isMe) => {
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, i) => {
      if (part.match(urlRegex)) {
        const href = part.startsWith('www.') ? `https://${part}` : part;
        return (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center underline font-bold hover:opacity-80 transition-all break-all underline-offset-2 mx-0.5"
            style={{ color: isMe ? 'var(--pecs-bg)' : 'var(--pecs-accent)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {part}
            <ExternalLink className="w-3 h-3 ml-1 inline-block shrink-0 opacity-80" />
          </a>
        );
      }
      return part;
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center space-x-2 mb-3">
        <MessageCircle className="w-4 h-4" style={{ color: 'var(--pecs-accent)' }} />
        <h2 className="text-base font-semibold text-white">Messages</h2>
        {disabled && (
          <span className="ml-auto text-xs font-mono" style={{ color: 'var(--pecs-text-muted)' }}>
            connect to chat
          </span>
        )}
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--pecs-text-muted)' }}>
        Send any messages in a flash
      </p>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-0 chat-scroll">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4 }}
              className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
              style={{ background: 'var(--pecs-surface)' }}
            >
              <MessageCircle className="w-5 h-5" style={{ color: 'var(--pecs-text-muted)' }} />
            </motion.div>
            <p className="text-sm" style={{ color: 'var(--pecs-text-muted)' }}>No messages yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--pecs-text-muted)', opacity: 0.6 }}>
              Messages are end-to-end encrypted
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((msg) => {
              const isMe = msg.sender === 'me';
              const isCopied = copiedId === msg.id;

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group relative`}
                >
                  <div className="flex items-center space-x-1.5 max-w-[85%]">
                    {!isMe && (
                      <button
                        type="button"
                        onClick={() => handleCopyText(msg.id, msg.text)}
                        title="Copy text to clipboard"
                        className={`
                          p-1.5 rounded-lg transition-all flex-shrink-0
                          ${isCopied
                            ? 'text-[var(--pecs-success)] scale-110'
                            : 'opacity-0 group-hover:opacity-100 hover:bg-[var(--pecs-surface)]'
                          }
                        `}
                        style={{ color: isCopied ? 'var(--pecs-success)' : 'var(--pecs-text-muted)' }}
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    )}

                    <div
                      className={`
                        px-3.5 py-2 rounded-2xl text-sm leading-relaxed break-words relative transition-all
                        ${isMe ? 'rounded-br-sm' : 'rounded-bl-sm'}
                        ${isCopied ? 'ring-2 ring-[var(--pecs-success)]/50' : ''}
                      `}
                      style={{
                        background: isMe ? 'var(--pecs-accent)' : 'var(--pecs-surface)',
                        color: isMe ? 'var(--pecs-bg)' : 'var(--pecs-text)',
                        border: isMe ? 'none' : '1px solid var(--pecs-border)',
                      }}
                    >
                      {renderMessageContent(msg.text, isMe)}
                    </div>

                    {isMe && (
                      <button
                        type="button"
                        onClick={() => handleCopyText(msg.id, msg.text)}
                        title="Copy text to clipboard"
                        className={`
                          p-1.5 rounded-lg transition-all flex-shrink-0
                          ${isCopied
                            ? 'text-[var(--pecs-success)] scale-110'
                            : 'opacity-0 group-hover:opacity-100 hover:bg-[var(--pecs-surface)]'
                          }
                        `}
                        style={{ color: isCopied ? 'var(--pecs-success)' : 'var(--pecs-text-muted)' }}
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>

                  <span className="text-[10px] mt-1 px-1" style={{ color: 'var(--pecs-text-muted)' }}>
                    {formatTime(msg.timestamp)}
                  </span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="mt-3 flex items-center space-x-2"
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled}
          placeholder={disabled ? 'Connect to start chatting...' : 'Type a message...'}
          className="pecs-input flex-1 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <motion.button
          type="submit"
          disabled={disabled || !input.trim()}
          whileHover={!disabled && input.trim() ? { scale: 1.05 } : {}}
          whileTap={!disabled && input.trim() ? { scale: 0.95 } : {}}
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          style={{
            background: 'var(--pecs-accent)',
            color: 'var(--pecs-bg)',
          }}
        >
          <Send className="w-4 h-4" />
        </motion.button>
      </form>
    </div>
  );
}
