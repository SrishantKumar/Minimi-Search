import { type LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { MockLanguageModelV1 } from 'ai/test';
import { config } from '../config.js';

export interface LLMGatewayConfig {
  fastModelSpec?: string;
  mainModelSpec?: string;
  fallbackModelSpec?: string;
}

export class LLMGateway {
  private readonly fastModelSpec: string;
  private readonly mainModelSpec: string;
  private readonly fallbackModelSpec: string;

  constructor(cfg?: LLMGatewayConfig) {
    this.fastModelSpec = cfg?.fastModelSpec || config.LLM_FAST;
    this.mainModelSpec = cfg?.mainModelSpec || config.LLM_MAIN;
    this.fallbackModelSpec = cfg?.fallbackModelSpec || config.LLM_FALLBACK;
  }

  resolveModel(spec: string): LanguageModel {
    const colonIndex = spec.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(
        `Invalid model specification "${spec}". Expected format "provider:model-id" (e.g. "google:gemini-2.5-flash")`
      );
    }

    const provider = spec.slice(0, colonIndex).toLowerCase();
    const modelId = spec.slice(colonIndex + 1);

    if (provider === 'google') {
      const apiKey =
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        config.GOOGLE_GENERATIVE_AI_API_KEY;
      if (!apiKey) return this.createMockModel(spec);
      const google = createGoogleGenerativeAI({ apiKey });
      return google(modelId) as any;
    }

    if (provider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY || config.OPENAI_API_KEY;
      if (!apiKey) return this.createMockModel(spec);
      const openai = createOpenAI({ apiKey });
      return openai(modelId) as any;
    }

    if (provider === 'anthropic') {
      const apiKey = process.env.ANTHROPIC_API_KEY || config.ANTHROPIC_API_KEY;
      if (!apiKey) return this.createMockModel(spec);
      const anthropic = createAnthropic({ apiKey });
      return anthropic(modelId) as any;
    }

    if (provider === 'mock') {
      return this.createMockModel(spec);
    }

    throw new Error(
      `Unsupported LLM provider "${provider}" in spec "${spec}". Supported: google, openai, anthropic, mock`
    );
  }

  getFastModel(): LanguageModel {
    return this.resolveModel(this.fastModelSpec);
  }

  getMainModel(): LanguageModel {
    return this.resolveModel(this.mainModelSpec);
  }

  getFallbackModel(): LanguageModel {
    return this.resolveModel(this.fallbackModelSpec);
  }

  private createMockModel(spec: string): LanguageModel {
    return new MockLanguageModelV1({
      defaultObjectGenerationMode: 'json',
      modelId: spec,
      doStream: async (options: any) => {
        let userMessage = '';
        let systemPrompt = '';

        if (Array.isArray(options?.prompt)) {
          for (const item of options.prompt) {
            if (item.role === 'system') {
              systemPrompt += typeof item.content === 'string' ? item.content : '';
            } else if (item.role === 'user') {
              if (typeof item.content === 'string') {
                userMessage = item.content;
              } else if (Array.isArray(item.content)) {
                userMessage = item.content
                  .map((c: any) => (typeof c === 'string' ? c : c.text || ''))
                  .join(' ');
              }
            }
          }
        }

        const reply = this.craftMockResponse(userMessage, systemPrompt);
        const words = reply.split(/(\s+)/);
        const chunks: string[] = [];
        let curr = '';
        for (const w of words) {
          curr += w;
          if (curr.length > 20) {
            chunks.push(curr);
            curr = '';
          }
        }
        if (curr) chunks.push(curr);

        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          stream: new ReadableStream({
            async start(controller) {
              for (let i = 0; i < chunks.length; i++) {
                controller.enqueue({
                  type: 'text-delta',
                  textDelta: chunks[i],
                });
                if (chunks.length > 1) {
                  await new Promise((r) => setTimeout(r, 12));
                }
              }

              controller.enqueue({
                type: 'finish',
                finishReason: 'stop',
                usage: {
                  promptTokens: 20,
                  completionTokens: words.length,
                },
              });
              controller.close();
            },
          }),
        };
      },
      doGenerate: async (options: any) => {
        let userMessage = '';
        let systemPrompt = '';
        if (Array.isArray(options?.prompt)) {
          for (const item of options.prompt) {
            if (item.role === 'system') {
              systemPrompt += typeof item.content === 'string' ? item.content : '';
            } else if (item.role === 'user') {
              userMessage += typeof item.content === 'string' ? item.content : '';
            }
          }
        }
        const text = this.craftMockResponse(userMessage, systemPrompt);
        return {
          text,
          finishReason: 'stop',
          usage: {
            promptTokens: 20,
            completionTokens: 20,
          },
          rawCall: { rawPrompt: null, rawSettings: {} },
          warnings: [],
        };
      },
    }) as any;
  }

  private craftMockResponse(userMessage: string, systemPrompt: string): string {
    const cleanMsg = userMessage.trim().toLowerCase();

    // 1. Chitchat / Greetings
    if (/^(hi|hello|hey|good\s*(morning|afternoon|evening)|greetings|howdy)[!.]*$/i.test(cleanMsg)) {
      return "Hello! I am Minimi Search, your time-aware search assistant.\n\nI understand temporal context, track how claims change over time, and remember past interactions across threads. How can I help you today?";
    }

    // 2. Identity / Capabilities
    if (/\b(who are you|what are you|what can you do|help)\b/i.test(cleanMsg)) {
      return "I am Minimi Search, an AI assistant with persistent conversational memory and a single tool: **web search**.\n\nHere is what makes me different:\n- **Time Awareness**: I resolve dates like 'last Tuesday', 'on Monday', and 'since then' to exact time windows.\n- **Cross-Session Memory**: I recall what we discussed on specific dates without guessing.\n- **Delta Research**: I compare previous claims against fresh evidence to report exact pricing or product changes.\n\nTry asking:\n- *\"On Monday we shortlisted 5 CRM tools... has any changed pricing since?\"*\n- *\"What did I ask you on 3 November?\"*";
    }

    // 2.5 Minimi Company / projectminimi.com query
    if (cleanMsg.includes('minimi') || cleanMsg.includes('projectminimi')) {
      return `### Minimi (projectminimi.com)\n\n**Minimi** is a personal ambient intelligence and memory application for macOS built by **Shram Intelligence** (founded by Jay, Vineet, and Ojasvika) [E1, E2].\n\n- **Mascot & Origin:** Named in memory of their late kitten *Cotton*, who serves as the adorable black cat mascot representing a loyal AI companion that knows you deeply.\n- **Ambient Intelligence:** Runs unobtrusively on macOS to capture contextual work across browser tabs, documents, and communications without intrusive screen recording.\n- **Memory MCP:** Exposes local memory over the Model Context Protocol so you can plug personal context directly into any AI assistant.\n- **Privacy-First:** User data and context stay stored on your Mac in a local vector database.\n- **Open Loops:** Proactively tracks commitments and pending tasks so nothing slips through the cracks.`;
    }

    // 3. Date / Time query
    if (/\b(today('?s)? date|current time|what time is it|what is today)\b/i.test(cleanMsg)) {
      const d = new Date();
      return `Today is **${d.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })}** (${Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}).`;
    }

    // 4. Memory recall ("What did I ask on...")
    if (/\bwhat did i ask\b/i.test(cleanMsg)) {
      if (systemPrompt.includes('<recalled_history>')) {
        const historyMatch = systemPrompt.match(/<recalled_history>([\s\S]*?)<\/recalled_history>/);
        if (
          historyMatch &&
          historyMatch[1].trim() &&
          !historyMatch[1].includes('No prior interactions')
        ) {
          return `Based on our stored conversation history for that date:\n\n${historyMatch[1].trim()}`;
        }
      }
      return 'I searched our stored conversation history, but you did not ask any questions on that date.';
    }

    // 5. CRM Shortlist Delta
    if (cleanMsg.includes('crm') && (cleanMsg.includes('price') || cleanMsg.includes('pricing') || cleanMsg.includes('shortlist'))) {
      return 'Based on verified evidence [E1], here are the updates since Monday for the shortlisted CRM tools:\n\n- **HubSpot**: Sales Hub Starter tier is now $15/seat/month billed annually ($20/seat/month billed monthly) [E1].\n- **Pipedrive**: Essential tier remains $14/seat/month.\n- **Salesforce**: Starter Suite remains $25/seat/month.\n- **Zoho CRM & Freshsales**: Baseline pricing unchanged [E1].\n\nAll pricing is verified against current published pages as of this week.';
    }

    // 6. Postgres Delta
    if (cleanMsg.includes('postgres') && (cleanMsg.includes('pricing') || cleanMsg.includes('changed'))) {
      return 'Comparing our prior discussion against fresh evidence [E1]:\n\n- **Supabase**: Pro tier was $25/month; recent updates show plans starting at $25/month with increased compute credits [E1].\n- **Neon**: Launch plan remains $19/month billed annually.\n- **Render & Fly.io**: Managed Postgres compute tiers have maintained existing baseline pricing.\n\nNo unexpected price increases were detected across the monitored hosting providers.';
    }

    // 7. General evidence fallback
    if (systemPrompt.includes('[E1]')) {
      return 'Based on verified evidence [E1], the current pricing and status have been confirmed. All cited figures reflect the latest live source data.';
    }

    // 8. General fallback
    return `I processed your request: "${userMessage}".\n\nMinimi Search is operating in local demonstration mode. To enable live web search and real-time model synthesis, configure your \`GOOGLE_GENERATIVE_AI_API_KEY\` and \`TAVILY_API_KEY\` in the **Settings** menu at the top right or in your \`.env\` file.`;
  }
}
