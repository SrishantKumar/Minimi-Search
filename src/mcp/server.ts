import readline from 'readline';
import { createDatabase } from '../memory/store/db.js';
import {
  MessageRepository,
  ClaimRepository,
  ContextObjectRepository,
} from '../memory/store/repository.js';
import { SqliteBlobVectorIndex } from '../memory/store/vector-index.js';
import { RecallEngine } from '../memory/recall.js';
import { TemporalResolver } from '../time/resolver.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export async function startMcpServer(): Promise<void> {
  const db = await createDatabase();
  const messageRepo = new MessageRepository(db);
  const claimRepo = new ClaimRepository(db);
  const objectRepo = new ContextObjectRepository(db);
  const vectorIndex = new SqliteBlobVectorIndex(db);
  const recallEngine = new RecallEngine(messageRepo, claimRepo, objectRepo, vectorIndex);
  const resolver = new TemporalResolver();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const sendResponse = (res: JsonRpcResponse) => {
    process.stdout.write(JSON.stringify(res) + '\n');
  };

  rl.on('line', async (line) => {
    if (!line.trim()) return;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(line);
    } catch {
      sendResponse({
        jsonrpc: '2.0',
        id: 0,
        error: { code: -32700, message: 'Parse error' },
      });
      return;
    }

    try {
      switch (req.method) {
        case 'tools/list': {
          sendResponse({
            jsonrpc: '2.0',
            id: req.id,
            result: {
              tools: [
                {
                  name: 'search_memories',
                  description:
                    'Search past conversational turns using SQLite FTS5 lexical matching and semantic vector similarity.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      query: { type: 'string', description: 'Topic or keyword to find' },
                      userId: { type: 'string', description: 'User identifier', default: 'default_user' },
                      limit: { type: 'number', description: 'Max results', default: 5 },
                    },
                    required: ['query'],
                  },
                },
                {
                  name: 'recall_by_date',
                  description:
                    'Retrieve exact conversation turns bounded by natural date strings (e.g. "on Monday", "3 November").',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      dateQuery: { type: 'string', description: 'Natural date expression (e.g. "Monday", "3 November")' },
                      userId: { type: 'string', description: 'User identifier', default: 'default_user' },
                      tz: { type: 'string', description: 'User timezone', default: 'UTC' },
                    },
                    required: ['dateQuery'],
                  },
                },
                {
                  name: 'get_claims',
                  description: 'Look up structured, dated claims recorded in the Claim Ledger by subject name.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      subject: { type: 'string', description: 'Subject or product name (e.g. "Supabase Pro")' },
                      userId: { type: 'string', description: 'User identifier', default: 'default_user' },
                    },
                    required: ['subject'],
                  },
                },
              ],
            },
          });
          break;
        }

        case 'tools/call': {
          const { name, arguments: args } = (req.params || {}) as {
            name: string;
            arguments: Record<string, unknown>;
          };
          const userId = (args?.userId as string) || 'default_user';

          if (name === 'search_memories') {
            const q = (args?.query as string) || '';
            const limit = (args?.limit as number) || 5;
            const msgs = messageRepo.searchFts(userId, q, limit);
            sendResponse({
              jsonrpc: '2.0',
              id: req.id,
              result: {
                content: [{ type: 'text', text: JSON.stringify(msgs, null, 2) }],
              },
            });
          } else if (name === 'recall_by_date') {
            const dateStr = (args?.dateQuery as string) || '';
            const tz = (args?.tz as string) || 'UTC';
            const frame = resolver.resolve(dateStr, { tz });
            const bundle = await recallEngine.recall(userId, dateStr, frame.refs[0]);
            sendResponse({
              jsonrpc: '2.0',
              id: req.id,
              result: {
                content: [{ type: 'text', text: JSON.stringify(bundle, null, 2) }],
              },
            });
          } else if (name === 'get_claims') {
            const subject = (args?.subject as string) || '';
            const claims = claimRepo.getBySubject(userId, subject);
            sendResponse({
              jsonrpc: '2.0',
              id: req.id,
              result: {
                content: [{ type: 'text', text: JSON.stringify(claims, null, 2) }],
              },
            });
          } else {
            sendResponse({
              jsonrpc: '2.0',
              id: req.id,
              error: { code: -32601, message: `Tool "${name}" not found` },
            });
          }
          break;
        }

        default: {
          sendResponse({
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32601, message: 'Method not found' },
          });
        }
      }
    } catch (err: unknown) {
      sendResponse({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' },
      });
    }
  });
}

// Auto-start if invoked directly as CLI
if (process.argv[1]?.endsWith('src/mcp/server.ts') || process.argv[1]?.endsWith('src/mcp/server.js')) {
  startMcpServer();
}

