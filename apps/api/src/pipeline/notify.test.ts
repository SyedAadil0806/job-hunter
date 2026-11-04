import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDigest } from './notify';

const job = { title: 'React Developer', company: 'Acme', location: 'Dubai', score: 85 };

test('stays quiet when nothing happened', () => {
  assert.equal(buildDigest({ newlyReady: [], errors: [] }), null);
});

test('lists new jobs and links to the dashboard', () => {
  const text = buildDigest({ newlyReady: [job], errors: [], dashboardUrl: 'https://x.vercel.app' })!;
  assert.match(text, /1 new job ready/);
  assert.match(text, /85 – React Developer @ Acme, Dubai/);
  assert.match(text, /href="https:\/\/x\.vercel\.app"/);
});

test('escapes characters Telegram would treat as HTML', () => {
  const text = buildDigest({ newlyReady: [{ ...job, company: 'R&D <Labs>' }], errors: [] })!;
  assert.match(text, /R&amp;D &lt;Labs&gt;/);
});

test('reports quota and other problems without showing their raw text', () => {
  const text = buildDigest({ newlyReady: [], errors: ['tailor 1: Gemini free quota reached: secret detail', 'jooble: HTTP 403'] })!;
  assert.match(text, /free limit ran out/);
  assert.match(text, /1 problem in this run/);
  assert.doesNotMatch(text, /secret detail|jooble/);
});

test('shortens a very long list', () => {
  const text = buildDigest({ newlyReady: Array.from({ length: 20 }, () => job), errors: [] })!;
  assert.match(text, /20 new jobs ready/);
  assert.match(text, /and 5 more/);
});
