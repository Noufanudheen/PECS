import React, { useEffect, useRef } from 'react';
import { MessageCircle, Send } from 'lucide-react';

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'me' | 'peer';
  timestamp: number;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  disabled?: boolean;
}

export default function ChatPanel({ messages, onSend, disabled }: ChatPanelProps) {
  const [input, setInput] = React.useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput('');
    inputRef.current?.focus();
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === 'me' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`
                  max-w-[80%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed break-words
                  ${msg.sender === 'me'
                    ? 'bg-indigo-600 text-white rounded-br-sm'
                    : 'bg-zinc-800 text-zinc-100 rounded-bl-sm border border-zinc-700/50'
                  }
                `}
              >
                {msg.text}
              </div>
              <span className="text-[10px] text-zinc-600 mt-1 px-1">
                {formatTime(msg.timestamp)}
              </span>
            </div>
          ))
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
