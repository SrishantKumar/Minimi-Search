import type { FastifyReply, FastifyRequest } from 'fastify';
import { SSEEventSchemaMap, type SSEEventName, type SSEEventData } from '../core/events.js';

export interface SSEWriter {
  emit<K extends SSEEventName>(event: K, data: SSEEventData<K>): void;
  comment(text: string): void;
  close(): void;
  readonly isClosed: boolean;
  readonly signal: AbortSignal;
}

export function createSSEWriter(request: FastifyRequest, reply: FastifyReply): SSEWriter {
  const abortController = new AbortController();
  let isClosed = false;

  // Disable Nagle buffering so tokens and events stream immediately with zero TCP delay
  if (typeof request.raw.socket?.setNoDelay === 'function') {
    request.raw.socket.setNoDelay(true);
  }

  // Merge any Fastify-staged headers (such as Set-Cookie)
  const pendingHeaders = typeof reply.getHeaders === 'function' ? reply.getHeaders() : {};
  const headers: Record<string, any> = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  };

  for (const [key, val] of Object.entries(pendingHeaders)) {
    if (val !== undefined) {
      headers[key] = val;
    }
  }

  reply.raw.writeHead(200, headers);
  if (typeof reply.raw.flushHeaders === 'function') {
    reply.raw.flushHeaders();
  }

  const onClientDisconnect = () => {
    if (!isClosed && !reply.raw.writableEnded) {
      isClosed = true;
      clearInterval(heartbeat);
      abortController.abort();
    }
  };

  request.raw.socket?.on('close', () => {
    if (!reply.raw.writableEnded) {
      onClientDisconnect();
    }
  });
  request.raw.on('aborted', onClientDisconnect);

  const heartbeat = setInterval(() => {
    if (isClosed || reply.raw.writableEnded) {
      clearInterval(heartbeat);
      return;
    }
    reply.raw.write(': heartbeat\n\n');
  }, 15000);

  const writer: SSEWriter = {
    get isClosed() {
      return isClosed || reply.raw.writableEnded;
    },
    get signal() {
      return abortController.signal;
    },
    emit<K extends SSEEventName>(event: K, data: SSEEventData<K>) {
      if (isClosed || reply.raw.writableEnded) return;

      const schema = SSEEventSchemaMap[event];
      const parsed = schema.safeParse(data);
      if (!parsed.success) {
        console.error(`SSE event validation failed for ${event}:`, parsed.error);
        return;
      }

      const payload = JSON.stringify(parsed.data);
      reply.raw.write(`event: ${event}\ndata: ${payload}\n\n`);
      if (typeof (reply.raw as unknown as { flush?: () => void }).flush === 'function') {
        (reply.raw as unknown as { flush: () => void }).flush();
      }
    },
    comment(text: string) {
      if (isClosed || reply.raw.writableEnded) return;
      reply.raw.write(`: ${text}\n\n`);
    },
    close() {
      if (isClosed) return;
      isClosed = true;
      clearInterval(heartbeat);
      reply.raw.end();
    },
  };

  return writer;
}
