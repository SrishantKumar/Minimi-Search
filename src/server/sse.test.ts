import { describe, it, expect, vi } from 'vitest';
import { createSSEWriter } from './sse.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { EventEmitter } from 'events';

describe('SSEWriter', () => {
  it('formats SSE messages according to spec and handles termination', () => {
    const rawReq = new EventEmitter();
    const rawSocket = new EventEmitter();
    Object.assign(rawReq, { socket: rawSocket });
    const rawReply = new EventEmitter();
    const writtenChunks: string[] = [];

    const mockReplyRaw = Object.assign(rawReply, {
      writeHead: vi.fn(),
      write: vi.fn((chunk: string) => {
        writtenChunks.push(chunk);
        return true;
      }),
      end: vi.fn(),
      writableEnded: false,
    });

    const mockRequest = { raw: rawReq } as unknown as FastifyRequest;
    const mockReply = { raw: mockReplyRaw } as unknown as FastifyReply;

    const writer = createSSEWriter(mockRequest, mockReply);

    expect(mockReplyRaw.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      })
    );

    // Emit typed status
    writer.emit('status', { stage: 'recalling', label: 'Checking past memory' });
    expect(writtenChunks.length).toBe(1);
    expect(writtenChunks[0]).toContain('event: status\n');
    expect(writtenChunks[0]).toContain('"stage":"recalling"');
    expect(writtenChunks[0]).toContain('"label":"Checking past memory"');

    // Emit token
    writer.emit('token', { t: 'Hello' });
    expect(writtenChunks.length).toBe(2);
    expect(writtenChunks[1]).toBe('event: token\ndata: {"t":"Hello"}\n\n');

    // Close
    writer.close();
    expect(writer.isClosed).toBe(true);
    expect(mockReplyRaw.end).toHaveBeenCalled();
  });

  it('triggers abort signal when client socket disconnects', () => {
    const rawReq = new EventEmitter();
    const rawSocket = new EventEmitter();
    Object.assign(rawReq, { socket: rawSocket });
    const rawReply = new EventEmitter();
    const mockReplyRaw = Object.assign(rawReply, {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      writableEnded: false,
    });

    const mockRequest = { raw: rawReq } as unknown as FastifyRequest;
    const mockReply = { raw: mockReplyRaw } as unknown as FastifyReply;

    const writer = createSSEWriter(mockRequest, mockReply);
    expect(writer.signal.aborted).toBe(false);

    rawSocket.emit('close');
    expect(writer.signal.aborted).toBe(true);
    expect(writer.isClosed).toBe(true);
  });
});
