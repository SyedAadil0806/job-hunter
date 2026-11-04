import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

export type Provider = 'gemini' | 'claude';

export interface StructuredRequest<T extends z.ZodTypeAny> {
  /** "score" uses the cheap/fast model, "tailor" uses the stronger one. */
  task: 'score' | 'tailor';
  system: string;
  prompt: string;
  /** Short name for the output, e.g. "record_score". */
  name: string;
  description: string;
  /** JSON Schema (object properties + required) shown to the model. */
  schema: { properties: Record<string, unknown>; required: string[] };
  /** Zod schema used to check what comes back. */
  validator: T;
  maxTokens?: number;
}

/** Thrown when the free quota is used up, so loops can stop early instead of failing 60 times. */
export class QuotaError extends Error {
  readonly quota = true;
}
export const isQuotaError = (e: unknown): e is QuotaError => Boolean((e as { quota?: boolean })?.quota);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_MODELS: Record<Provider, Record<'score' | 'tailor', string>> = {
  gemini: { score: 'gemini-flash-lite-latest', tailor: 'gemini-flash-latest' },
  claude: { score: 'claude-haiku-5-5', tailor: 'claude-sonnet-5-5' },
};

const DEFAULT_GEMINI_FALLBACKS = 'gemini-flash-latest,gemini-flash-lite-latest';

/**
 * One place for all AI calls. Pick the provider with AI_PROVIDER=gemini|claude.
 * If AI_PROVIDER is not set, it uses whichever key you have (Gemini first, since it's free).
 * Every answer is forced into a JSON schema and checked with zod.
 */
@Injectable()
export class AiService {
  private readonly log = new Logger(AiService.name);
  private claude?: Anthropic;
  private gemini?: GoogleGenAI;
  private lastCall = 0;
  /** Gemini model that answered the last call (may be a backup). Undefined for Claude. */
  lastModel?: string;
  overloadBackoffMs = 3_000;

  get provider(): Provider | undefined {
    const wanted = process.env.AI_PROVIDER?.trim().toLowerCase();
    if (wanted === 'gemini' || wanted === 'claude') return wanted;
    if (process.env.GEMINI_API_KEY) return 'gemini';
    if (process.env.ANTHROPIC_API_KEY) return 'claude';
    return undefined;
  }

  isEnabled(): boolean {
    const p = this.provider;
    return p === 'gemini' ? Boolean(process.env.GEMINI_API_KEY) : p === 'claude' ? Boolean(process.env.ANTHROPIC_API_KEY) : false;
  }

  /** Human-readable reason the AI is off, for logs and run summaries. */
  disabledReason(): string {
    const p = this.provider;
    if (!p) return 'No AI key set (add GEMINI_API_KEY for free, or ANTHROPIC_API_KEY)';
    return `AI_PROVIDER is ${p} but ${p === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'} is not set`;
  }

  modelFor(task: 'score' | 'tailor'): string {
    const p = this.provider ?? 'gemini';
    const env = process.env[`${p.toUpperCase()}_${task.toUpperCase()}_MODEL`];
    return env?.trim() || DEFAULT_MODELS[p][task];
  }

  async structured<T extends z.ZodTypeAny>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    if (!this.isEnabled()) throw new Error(this.disabledReason());
    this.lastModel = undefined;
    const raw = this.provider === 'gemini' ? await this.callGemini(req) : await this.callClaude(req);
    const parsed = req.validator.safeParse(raw);
    if (!parsed.success) {
      this.log.warn(`Invalid ${req.name} output: ${parsed.error.message}`);
      throw new Error(`AI returned invalid ${req.name} data`);
    }
    return parsed.data;
  }

  // ---------- Claude: force a tool call so the reply matches the schema ----------
  private async callClaude<T extends z.ZodTypeAny>(req: StructuredRequest<T>): Promise<unknown> {
    this.claude ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3 });
    const res = await this.claude.messages.create({
      model: this.modelFor(req.task),
      max_tokens: req.maxTokens ?? 2000,
      system: req.system,
      tools: [
        {
          name: req.name,
          description: req.description,
          input_schema: { type: 'object', ...req.schema } as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: req.name },
      messages: [{ role: 'user', content: req.prompt }],
    });
    const block = res.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') throw new Error(`Claude did not return ${req.name} (stop_reason=${res.stop_reason})`);
    return block.input;
  }

  // ---------- Gemini: JSON mode with a response schema ----------
  private async callGemini<T extends z.ZodTypeAny>(req: StructuredRequest<T>): Promise<unknown> {
    this.gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Free tier has a per-minute limit, so space calls out a little.
    const gap = Number(process.env.GEMINI_MIN_INTERVAL_MS ?? 4500);
    const wait = this.lastCall + gap - Date.now();
    if (wait > 0) await sleep(wait);

    const maxAttempts = 4;
    const maxOverloadAttempts = 3;
    const models = this.geminiModels(req.task);
    for (const [i, model] of models.entries()) {
      const next = models[i + 1];
      for (let attempt = 1; ; attempt++) {
        this.lastCall = Date.now();
        try {
          const res = await this.gemini.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
            config: {
              systemInstruction: `${req.system}\n\nReply only with JSON for "${req.name}": ${req.description}`,
              responseMimeType: 'application/json',
              responseJsonSchema: { type: 'object', ...req.schema },
              // No maxOutputTokens: newer Flash models "think" first, and a low cap can cut off the JSON.
              temperature: req.task === 'score' ? 0.2 : 0.5,
            },
          });
          const usage = res.usageMetadata;
          this.log.log(
            `${req.task} on ${model}: tokens in ${usage?.promptTokenCount ?? '?'}, out ${usage?.candidatesTokenCount ?? '?'}, ` +
              `thinking ${usage?.thoughtsTokenCount ?? 0}, total ${usage?.totalTokenCount ?? '?'}`,
          );
          const text = res.text;
          if (!text) throw new Error(`Gemini returned no text (finish=${res.candidates?.[0]?.finishReason ?? 'unknown'})`);
          try {
            const json: unknown = JSON.parse(text);
            this.lastModel = model;
            return json;
          } catch {
            throw new Error('Gemini returned text that is not valid JSON');
          }
        } catch (e) {
          const status = (e as { status?: number }).status;
          const msg = (e as Error).message ?? '';
          const rateLimited = status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg);
          const daily = /per.?day|daily/i.test(msg);
          const overloaded = !rateLimited && status !== undefined && status >= 500;
          if (rateLimited && (daily || attempt >= maxAttempts)) {
            // Each model has its own free limit, so another model may still have room.
            if (!next) throw new QuotaError(`Gemini free quota reached: ${msg.slice(0, 160)}`);
            this.log.warn(`Gemini quota used up on ${model}, trying ${next}`);
            break;
          }
          // Model removed (404) or still overloaded after retries: move on to the next model.
          if (status === 404 || (overloaded && attempt >= maxOverloadAttempts)) {
            if (!next) throw e;
            this.log.warn(`Gemini ${status} on ${model}, trying ${next}`);
            break;
          }
          if (!rateLimited && !overloaded) throw e;
          const backoff = rateLimited ? 20_000 * attempt : this.overloadBackoffMs * attempt;
          this.log.warn(`Gemini ${status ?? ''} (attempt ${attempt}), waiting ${backoff / 1000}s`);
          await sleep(backoff);
        }
      }
    }
    throw new Error('No Gemini model available');
  }

  /** The model for this task, then the backups. GEMINI_FALLBACK_MODELS="" turns backups off. */
  private geminiModels(task: 'score' | 'tailor'): string[] {
    const fallbacks = (process.env.GEMINI_FALLBACK_MODELS ?? DEFAULT_GEMINI_FALLBACKS).split(',').map((m) => m.trim()).filter(Boolean);
    return [...new Set([this.modelFor(task), ...fallbacks])];
  }

  /** Used by `npm run ai:check`: list Flash models this key can use. */
  async listGeminiModels(): Promise<string[]> {
    this.gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const names: string[] = [];
    const pager = await this.gemini.models.list();
    for await (const m of pager) {
      const name = (m.name ?? '').replace(/^models\//, '');
      if (/flash/i.test(name) && (m.supportedActions ?? []).includes('generateContent')) names.push(name);
    }
    return names.sort();
  }
}
