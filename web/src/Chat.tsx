import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Square,
  Sparkles,
  Calendar,
  Plus,
  MessageSquare,
  Trash2,
  PanelLeftClose,
  PanelLeft,
  TrendingUp,
  History,
  Globe,
  Bot,
  User as UserIcon,
} from 'lucide-react';
import { useChatStream } from './useChatStream.js';
import { StatusLine } from './StatusLine.js';
import { SourceChips } from './SourceChips.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

function preprocessMarkdown(content: string): string {
  if (!content) return '';
  let text = content.replace(/\r\n/g, '\n');

  // 1. Protect currency signs ($7/month, $20, $125.50) from KaTeX inline math corruption
  text = text.replace(/\\?\$(\d+(?:\.\d+)?)/g, '&#36;$1');

  // 2. Convert raw all-caps section titles (e.g. 'AI DEVELOPER TOOL PRICING', 'KEY TRENDS') into markdown headers
  text = text.replace(/^[ \t]*([A-Z][A-Z0-9\s()&/,\-–—]{3,80}[A-Z0-9)])[ \t]*$/gm, '### $1');

  // 3. Convert unicode bullets (•, ●, ▪) at the beginning of lines to standard markdown dashes
  text = text.replace(/^[ \t]*[•●▪]\s+/gm, '- ');

  // 4. Clean trailing | | on table lines
  text = text.replace(/\|\s*\|\s*$/gm, '|');

  // 5. Replace inline row breaks '| |' with line break
  text = text.replace(/\|\s*\|\s*/g, '|\n| ');

  // 6. Fix table rows where first column was split across lines or multi-line cell text
  const lines = text.split('\n');
  const result: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) {
      inTable = false;
      result.push('');
      continue;
    }

    if (line.startsWith('|')) {
      inTable = true;
      line = line.replace(/\|\s*\|\s*$/, '|');
      if (!line.endsWith('|')) {
        // Line starts with | but doesn't end with | (e.g. '| Claude Code (Anthropic)')
        if (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
          let nextLine = lines[i + 1].trim();
          nextLine = nextLine.replace(/\|\s*\|\s*$/, '|');
          const merged = line + ' ' + nextLine;
          i++;
          result.push(merged.endsWith('|') ? merged : merged + ' |');
        } else {
          result.push(line + ' |');
        }
      } else {
        result.push(line);
      }
    } else if (inTable) {
      // Continuation of a table cell across newlines
      const prev = result.pop() || '';
      if (prev.endsWith('|')) {
        const withoutPipe = prev.slice(0, -1).trimEnd();
        result.push(withoutPipe + ' ' + line + ' |');
      } else {
        result.push(prev + ' ' + line);
      }
    } else {
      result.push(line);
    }
  }

  let processed = result.join('\n');
  // Ensure blank line before table start if not already there
  processed = processed.replace(/([^\n|])\n(\|[^\n]+\|)/g, '$1\n\n$2');
  // Ensure blank line after table end if not already there
  processed = processed.replace(/(\|[^\n]+\|)\n([^\n|#\s*-])/g, '$1\n\n$2');

  return processed;
}

interface ChatProps {
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onOpenSettings?: () => void;
}

export const Chat: React.FC<ChatProps> = ({ sidebarOpen, setSidebarOpen, onOpenSettings }) => {
  const {
    messages,
    threads,
    activeThreadId,
    isStreaming,
    statusStage,
    statusLabel,
    sendMessage,
    cancelStream,
    startNewThread,
    selectThread,
    deleteThread,
  } = useChatStream();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, statusLabel]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isStreaming) return;
    const msg = input.trim();
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    sendMessage(msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const samplePrompts = [
    {
      title: 'Market & Pricing Delta',
      prompt: 'Compare pricing changes for AI developer tools over the past month.',
      desc: 'Tracks multi-entity price adjustments and subscription tiers',
      icon: <TrendingUp className="w-4 h-4 text-emerald-400" />,
    },
    {
      title: 'Temporal Fact Verification',
      prompt: 'What happened in tech on Monday? Check for any major updates since then.',
      desc: 'Resolves Monday to exact date and verifies developments since then',
      icon: <Calendar className="w-4 h-4 text-indigo-400" />,
    },
    {
      title: 'Conversational Memory',
      prompt: 'What did we discuss in our last session? Re-verify if the information is still accurate.',
      desc: 'Recalls prior turns from cross-session memory without hallucinating',
      icon: <History className="w-4 h-4 text-amber-400" />,
    },
    {
      title: 'Live Web Intelligence',
      prompt: 'What are the latest announcements and release notes for open-source LLMs this week?',
      desc: 'Executes bounded search queries with source evidence citations',
      icon: <Globe className="w-4 h-4 text-blue-400" />,
    },
  ];

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden relative">
      {/* Sidebar - Sessions History */}
      <aside
        className={`${
          sidebarOpen
            ? 'w-64 opacity-100 p-3 border-r border-zinc-800/60'
            : 'w-0 opacity-0 p-0 border-none pointer-events-none'
        } shrink-0 bg-zinc-950 flex flex-col transition-all duration-200 ease-in-out overflow-hidden z-20`}
      >
        <div className="w-58 min-w-[15rem] flex flex-col h-full">
          {/* New Session Button */}
          <button
            type="button"
            onClick={startNewThread}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 transition mb-3 group"
          >
            <span className="flex items-center gap-2">
              <Plus className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white" />
              <span>New Chat</span>
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">⌘N</span>
          </button>

          {/* Sessions List Header */}
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 px-2 py-1 flex items-center justify-between">
            <span>Past Sessions</span>
            <span className="text-[10px] text-zinc-600 font-mono">{threads.length}</span>
          </div>

          {/* Sessions List */}
          <div className="flex-1 overflow-y-auto space-y-1 mt-1 pr-1 scrollbar-thin">
            {threads.length === 0 ? (
              <div className="text-xs text-zinc-600 py-8 text-center px-4">
                No previous threads saved.
              </div>
            ) : (
              threads.map((t) => (
                <div
                  key={t.id}
                  onClick={() => selectThread(t.id)}
                  className={`group flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition cursor-pointer ${
                    activeThreadId === t.id
                      ? 'bg-zinc-800 text-white font-medium border border-zinc-700/60 shadow-sm'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate flex-1 mr-1">
                    <MessageSquare className="w-3.5 h-3.5 shrink-0 text-zinc-500 group-hover:text-zinc-400" />
                    <span className="truncate">{t.title}</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteThread(t.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-700 hover:text-rose-400 text-zinc-500 transition"
                    title="Delete Thread"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>

      {/* Main Chat Column */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-zinc-950">
        {/* Message Feed */}
        <div className="flex-1 overflow-y-auto px-4 py-6 scrollbar-thin">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.length === 0 ? (
              /* Modern Minimal Empty State */
              <div className="min-h-[50vh] flex flex-col items-center justify-center text-center px-4 pt-8 pb-4">
                <div className="flex items-center justify-center mb-5">
                  <img
                    src="/minimi-logo.png"
                    alt="Minimi"
                    className="h-10 w-auto brightness-0 invert opacity-95 select-none"
                  />
                </div>
                <h2 className="text-xl font-semibold text-zinc-100 tracking-tight flex items-center gap-2">
                  <span>Minimi Search</span>
                </h2>
                <p className="text-xs text-zinc-400 max-w-sm mt-1.5 leading-relaxed">
                  Time-aware search agent with persistent ambient memory and delta research.
                </p>

                {/* 2x2 Clean Starter Cards without Emojis */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-xl mt-8 text-left">
                  {samplePrompts.map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => sendMessage(item.prompt)}
                      className="p-3.5 rounded-2xl bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800/70 hover:border-zinc-700/80 transition-all text-left group flex flex-col justify-between"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="p-1 rounded-lg bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center">
                          {item.icon}
                        </span>
                        <span className="text-xs font-semibold text-zinc-200 group-hover:text-white">
                          {item.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-normal line-clamp-2">
                        {item.prompt}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Message Turn Flow */
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {/* Assistant Avatar */}
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 mt-0.5 overflow-hidden p-1 shadow-sm">
                      <img
                        src="/minimi-cat-white.png"
                        alt="Minimi"
                        className="w-4 h-4 object-contain select-none"
                      />
                    </div>
                  )}

                  {/* Message Bubble Container */}
                  <div
                    className={`flex flex-col max-w-[85%] ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    {/* User Bubble */}
                    {msg.role === 'user' ? (
                      <div className="px-4 py-2.5 rounded-2xl rounded-tr-sm bg-zinc-800 text-zinc-100 text-sm border border-zinc-700/50 shadow-sm leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    ) : (
                      /* Assistant Content Container */
                      <div className="w-full space-y-2">
                        {/* Temporal Frame resolution badge */}
                        {msg.frame && msg.frame.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {msg.frame.map((f, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] bg-zinc-900 text-zinc-300 border border-zinc-800 font-mono"
                              >
                                <Calendar className="w-3 h-3 text-zinc-400" />
                                <span>Interpreted "{f.surface}" as <b>{f.label}</b></span>
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Text Content */}
                        <div className="text-sm text-zinc-200 leading-relaxed space-y-2">
                          {msg.content ? (
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm, remarkMath]}
                              rehypePlugins={[rehypeKatex]}
                              components={{
                                p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed text-zinc-200">{children}</p>,
                                h1: ({ children }) => <h1 className="text-base font-semibold text-zinc-100 mt-5 mb-2.5 tracking-tight border-b border-zinc-800/80 pb-1.5">{children}</h1>,
                                h2: ({ children }) => <h2 className="text-sm font-semibold text-zinc-100 mt-4 mb-2 tracking-tight">{children}</h2>,
                                h3: ({ children }) => <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mt-3.5 mb-1.5">{children}</h3>,
                                ul: ({ children }) => <ul className="list-disc list-outside pl-5 space-y-1.5 my-2.5 text-zinc-200">{children}</ul>,
                                ol: ({ children }) => <ol className="list-decimal list-outside pl-5 space-y-1.5 my-2.5 text-zinc-200">{children}</ol>,
                                li: ({ children }) => <li className="leading-relaxed pl-0.5">{children}</li>,
                                strong: ({ children }) => <strong className="font-semibold text-zinc-100">{children}</strong>,
                                blockquote: ({ children }) => (
                                  <blockquote className="border-l-2 border-zinc-700 pl-3 my-2 text-zinc-400 italic">
                                    {children}
                                  </blockquote>
                                ),
                                code({ className, children, ...props }) {
                                  const isInline = !className;
                                  return isInline ? (
                                    <code className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-xs text-amber-200/90" {...props}>
                                      {children}
                                    </code>
                                  ) : (
                                    <pre className="p-3 my-2 rounded-xl bg-zinc-900/90 border border-zinc-800/80 overflow-x-auto text-xs font-mono text-zinc-200">
                                      <code className={className} {...props}>
                                        {children}
                                      </code>
                                    </pre>
                                  );
                                },
                                table: ({ children }) => (
                                  <div className="my-4 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/70 shadow-sm">
                                    <table className="min-w-full divide-y divide-zinc-800 text-xs text-left">
                                      {children}
                                    </table>
                                  </div>
                                ),
                                thead: ({ children }) => (
                                  <thead className="bg-zinc-900/90 text-zinc-200 font-medium">{children}</thead>
                                ),
                                tbody: ({ children }) => (
                                  <tbody className="divide-y divide-zinc-800/50 bg-transparent">{children}</tbody>
                                ),
                                tr: ({ children }) => (
                                  <tr className="hover:bg-zinc-900/40 transition-colors">{children}</tr>
                                ),
                                th: ({ children }) => (
                                  <th className="px-3.5 py-2.5 font-semibold text-zinc-200 tracking-wide text-xs">
                                    {children}
                                  </th>
                                ),
                                td: ({ children }) => (
                                  <td className="px-3.5 py-2.5 text-zinc-300 align-top leading-relaxed text-xs">
                                    {children}
                                  </td>
                                ),
                                a: ({ href, children }) => (
                                  <a
                                    href={href}
                                    className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {children}
                                  </a>
                                ),
                              }}
                            >
                              {preprocessMarkdown(msg.content)}
                            </ReactMarkdown>
                          ) : (
                            isStreaming && <span className="text-zinc-500 italic">Thinking...</span>
                          )}
                        </div>

                        {/* Evidence Source Chips */}
                        {msg.sources && msg.sources.length > 0 && (
                          <SourceChips sources={msg.sources} />
                        )}
                      </div>
                    )}
                  </div>

                  {/* User Avatar */}
                  {msg.role === 'user' && (
                    <div className="w-7 h-7 rounded-xl bg-zinc-800 border border-zinc-700/60 flex items-center justify-center shrink-0 mt-0.5 text-zinc-300">
                      <UserIcon className="w-3.5 h-3.5 text-zinc-400" />
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Live Streaming Indicator */}
            {isStreaming && (
              <div className="flex items-center gap-3 pl-1">
                <div className="w-7 h-7 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 overflow-hidden p-1 text-zinc-400">
                  <img
                    src="/minimi-cat-white.png"
                    alt="Minimi"
                    className="w-4 h-4 object-contain select-none animate-pulse"
                  />
                </div>
                <StatusLine stage={statusStage} label={statusLabel} />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Modern Floating Bottom Input */}
        <div className="p-4 bg-gradient-to-t from-zinc-950 via-zinc-950 to-transparent">
          <div className="max-w-3xl mx-auto relative">
            <form
              onSubmit={handleSubmit}
              className="flex items-end gap-2 bg-zinc-900/90 border border-zinc-800 rounded-2xl p-2 focus-within:border-zinc-700 focus-within:ring-1 focus-within:ring-zinc-700 transition shadow-xl backdrop-blur-md"
            >
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything, or reference a date (e.g. 'What did I ask on 3 Nov?')..."
                className="flex-1 bg-transparent border-0 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none resize-none px-2 py-1.5 max-h-40 leading-relaxed scrollbar-thin"
              />

              <div className="flex items-center gap-1.5 shrink-0">
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={cancelStream}
                    className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
                    title="Stop Generating"
                  >
                    <Square className="w-4 h-4 fill-zinc-300" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    className="p-2 rounded-xl bg-white text-zinc-950 hover:bg-zinc-200 disabled:opacity-30 disabled:hover:bg-white transition"
                    title="Send message"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
            </form>

            <div className="flex items-center justify-center px-2 pt-2 text-[10px] text-zinc-500">
              <span>Enter to send • Shift + Enter for new line</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
