import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, Copy, Check, ExternalLink } from 'lucide-react';

export default function ChatPanel({ messages, onSend, disabled }) {
  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
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
  const renderMessageContent = (text) => {
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
            className="inline-flex items-center underline font-medium hover:text-sky-300 transition-colors break-all underline-offset-2 mr-0.5"
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
        <MessageCircle className="w-4 h-4 text-zinc-400" />
        <h2 className="text-lg font-medium text-white">Chat</h2>
        {disabled && (
          <span className="ml-auto text-xs text-zinc-600 font-mono">connect to chat</span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0 chat-scroll">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="w-10 h-10 rounded-full bg-zinc-800/70 flex items-center justify-center mb-3">
              <MessageCircle className="w-5 h-5 text-zinc-600" />
            </div>
            <p className="text-zinc-600 text-sm">No messages yet</p>
            <p className="text-zinc-700 text-xs mt-1">Messages are end-to-end encrypted</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender === 'me';
            const isCopied = copiedId === msg.id;

            return (
              <div
                key={msg.id}
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
                          ? 'bg-emerald-500/20 text-emerald-400 scale-110'
                          : 'opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-white hover:bg-zinc-800'
                        }
                      `}
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}

                  <div
                    className={`
                      px-3.5 py-2 rounded-2xl text-sm leading-relaxed break-words relative transition-all
                      ${isMe
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : 'bg-zinc-800 text-zinc-100 rounded-bl-sm border border-zinc-700/50'
                      }
                      ${isCopied ? 'ring-2 ring-emerald-400/50' : ''}
                    `}
                  >
                    {renderMessageContent(msg.text)}
                  </div>

                  {isMe && (
                    <button
                      type="button"
                      onClick={() => handleCopyText(msg.id, msg.text)}
                      title="Copy text to clipboard"
                      className={`
                        p-1.5 rounded-lg transition-all flex-shrink-0
                        ${isCopied
                          ? 'bg-emerald-500/20 text-emerald-400 scale-110'
                          : 'opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-white hover:bg-zinc-800'
                        }
                      `}
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>

                <span className="text-[10px] text-zinc-600 mt-1 px-1">
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
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
          className="
            flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5
            text-sm text-white placeholder:text-zinc-700
            focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-all
          "
        />
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className="
            w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
            bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed
            transition-colors shadow-lg shadow-indigo-500/10
          "
        >
          <Send className="w-4 h-4 text-white" />
        </button>
      </form>
    </div>
  );
}
