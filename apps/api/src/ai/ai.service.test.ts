import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { z } from 'zod';
import { AiService, isQuotaError } from './ai.service';

const realFetch = globalThis.fetch;
const envBackup = { ...process.env };
let calls: { url: string; body: any }[] = [];

function fakeGemini(responder: (n: number) => { status: number; body: unknown }) {
  calls = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    const r = responder(calls.length);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

const req = {
  task: 'score' as const,
  system: 'sys',
  prompt: 'hi',
  name: 'test',
  description: 'test reply',
  schema: { properties: { score: { type: 'integer' } }, required: ['score'] },
  validator: z.object({ score: z.number() }),
};

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MIN_INTERVAL_MS = '0';
  delete process.env.AI_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_SCORE_MODEL;
  delete process.env.GEMINI_FALLBACK_MODELS;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...envBackup };
});

test('picks Gemini automatically when only a Gemini key is set', () => {
  const ai = new AiService();
  assert.equal(ai.provider, 'gemini');
  assert.equal(ai.modelFor('score'), 'gemini-flash-lite-latest');
  process.env.GEMINI_SCORE_MODEL = '';
  assert.equal(ai.modelFor('score'), 'gemini-flash-lite-latest', 'empty env var falls back to default');
});

test('is disabled with a clear reason when no key is set', () => {
  delete process.env.GEMINI_API_KEY;
  const ai = new AiService();
  assert.equal(ai.isEnabled(), false);
  assert.match(ai.disabledReason(), /GEMINI_API_KEY/);
});

test('sends JSON schema to Gemini and parses the reply', async () => {
  fakeGemini(() => ({
    status: 200,
    body: { candidates: [{ content: { role: 'model', parts: [{ text: '{"score": 82}' }] }, finishReason: 'STOP' }] },
  }));
  const out = await new AiService().structured(req);
  assert.deepEqual(out, { score: 82 });
  assert.match(calls[0].url, /gemini-flash-lite-latest:generateContent/);
  const cfg = calls[0].body.generationConfig;
  assert.equal(cfg.responseMimeType, 'application/json');
  assert.equal(cfg.responseJsonSchema.type, 'object');
  assert.deepEqual(cfg.responseJsonSchema.required, ['score']);
});

test('rejects a reply that does not match the schema', async () => {
  fakeGemini(() => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: '{"score": "high"}' }] } }] } }));
  await assert.rejects(new AiService().structured(req), /invalid test data/);
});

const okReply = { status: 200, body: { candidates: [{ content: { parts: [{ text: '{"score": 82}' }] } }] } };
const overloaded = { status: 503, body: { error: { code: 503, status: 'UNAVAILABLE', message: 'high demand' } } };

test('moves to the backup model when the main one stays overloaded', async () => {
  process.env.GEMINI_SCORE_MODEL = 'main-model';
  process.env.GEMINI_FALLBACK_MODELS = 'backup-model';
  fakeGemini((n) => (n <= 3 ? overloaded : okReply));
  const ai = new AiService();
  ai.overloadBackoffMs = 0;
  assert.deepEqual(await ai.structured(req), { score: 82 });
  assert.equal(calls.length, 4);
  assert.match(calls[2].url, /main-model:generateContent/);
  assert.match(calls[3].url, /backup-model:generateContent/);
  assert.equal(ai.lastModel, 'backup-model');
});

test('moves to the backup model straight away when a model is gone (404)', async () => {
  process.env.GEMINI_SCORE_MODEL = 'old-model';
  process.env.GEMINI_FALLBACK_MODELS = 'backup-model';
  fakeGemini((n) => (n === 1 ? { status: 404, body: { error: { code: 404, message: 'no longer available' } } } : okReply));
  assert.deepEqual(await new AiService().structured(req), { score: 82 });
  assert.equal(calls.length, 2);
});

test('fails when overloaded and backups are turned off', async () => {
  process.env.GEMINI_FALLBACK_MODELS = '';
  fakeGemini(() => overloaded);
  const ai = new AiService();
  ai.overloadBackoffMs = 0;
  await assert.rejects(ai.structured(req), /high demand/);
  assert.equal(calls.length, 3);
});

test('stops with a QuotaError when the daily free quota is used up', async () => {
  fakeGemini(() => ({
    status: 429,
    body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit per day' } },
  }));
  await assert.rejects(new AiService().structured(req), (e) => isQuotaError(e));
  assert.equal(calls.length, 1, 'does not keep retrying a daily limit');
});
