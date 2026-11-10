import { useState, useCallback, useRef, useEffect } from 'react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  status?: string;
  sources?: Array<{ id: string; url: string; title: string; domain: string }>;
  frame?: Array<{ surface: string; label: string; confidence: number }>;
}

export interface ThreadSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface UseChatStreamReturn {
  messages: ChatMessage[];
  threads: ThreadSummary[];
  activeThreadId: string | null;
  isStreaming: boolean;
  statusLabel: string | null;
  statusStage: string | null;
  sendMessage: (text: string) => Promise<void>;
  cancelStream: () => void;
  startNewThread: () => void;
  selectThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  refreshThreads: () => Promise<void>;
}

export function useChatStream(): UseChatStreamReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [statusStage, setStatusStage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refreshThreads = useCallback(async () => {
    try {
      const res = await fetch('/api/threads');
      if (res.ok) {
        const data = await res.json();
        setThreads(data.threads || []);
      }
    } catch (err) {
      console.warn('Failed to fetch threads:', err);
    }
  }, []);

  useEffect(() => {
    refreshThreads();
  }, [refreshThreads]);

  const cancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
      setStatusLabel(null);
      setStatusStage(null);
    }
  }, []);

  const startNewThread = useCallback(() => {
    cancelStream();
    setMessages([]);
    setActiveThreadId(null);
  }, [cancelStream]);

  const selectThread = useCallback(
    async (threadId: string) => {
      cancelStream();
      setActiveThreadId(threadId);
      try {
        const res = await fetch(`/api/threads/${threadId}`);
        if (res.ok) {
          const data = await res.json();
          const msgs: ChatMessage[] = (data.messages || []).map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
            sources: m.meta?.evidenceIds
              ? m.meta.evidenceIds.map((id: string) => ({ id, domain: 'web', title: 'Source', url: '#' }))
              : undefined,
          }));
          setMessages(msgs);
        }
      } catch (err) {
        console.error('Failed to load thread:', err);
      }
    },
    [cancelStream]
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      try {
        await fetch(`/api/threads/${threadId}`, { method: 'DELETE' });
        if (activeThreadId === threadId) {
          startNewThread();
        }
        await refreshThreads();
      } catch (err) {
        console.error('Failed to delete thread:', err);
      }
    },
    [activeThreadId, startNewThread, refreshThreads]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      const userMsgId = `user_${Date.now()}`;
      const assistantMsgId = `asst_${Date.now()}`;

      const userMessage: ChatMessage = {
        id: userMsgId,
        role: 'user',
        content: text.trim(),
        createdAt: Date.now(),
      };

      const assistantMessage: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsStreaming(true);
      setStatusLabel('Connecting...');
      setStatusStage('routing');

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text.trim(),
            threadId: activeThreadId || undefined,
            tz,
            clientNow: new Date().toISOString(),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('Response body not readable');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const block of parts) {
            if (!block.trim()) continue;

            const lines = block.split('\n');
            let eventType = 'message';
            let dataStr = '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventType = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                dataStr = line.slice(6).trim();
              }
            }

            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);

              switch (eventType) {
                case 'status':
                  setStatusStage(data.stage);
                  setStatusLabel(data.label);
                  break;

                case 'frame':
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMsgId ? { ...msg, frame: data.refs } : msg
                    )
                  );
                  break;

                case 'token':
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMsgId
                        ? { ...msg, content: msg.content + data.t }
                        : msg
                    )
                  );
                  break;

                case 'sources':
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMsgId
                        ? { ...msg, sources: data.evidence }
                        : msg
                    )
                  );
                  break;

                case 'done':
                  setStatusLabel(null);
                  setStatusStage(null);
                  refreshThreads();
                  break;

                case 'error':
                  setStatusLabel(`Error: ${data.userMessage}`);
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMsgId
                        ? { ...msg, content: `⚠️ ${data.userMessage}` }
                        : msg
                    )
                  );
                  break;
              }
            } catch (err) {
              console.warn('Failed to parse SSE JSON block:', err, dataStr);
            }
          }
        }
      } catch (err: unknown) {
        if (!controller.signal.aborted) {
          console.error('Stream failure:', err);
          setStatusLabel('Connection dropped');
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId && !msg.content
                ? { ...msg, content: 'Failed to communicate with Chronos backend.' }
                : msg
            )
          );
        }
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [activeThreadId, isStreaming, refreshThreads]
  );

  return {
    messages,
    threads,
    activeThreadId,
    isStreaming,
    statusLabel,
    statusStage,
    sendMessage,
    cancelStream,
    startNewThread,
    selectThread,
    deleteThread,
    refreshThreads,
  };
}
