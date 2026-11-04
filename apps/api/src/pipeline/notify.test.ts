import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDigest } from './notify';

const job = { title: 'React Developer', company: 'Acme', location: 'Dubai', score: 85 };

const base = { newJobs: 0, newlyReady: [], errors: [], tailorRan: true };

test('reports a run that found jobs but made no CVs', () => {
  assert.equal(buildDigest({ ...base, newJobs: 45 }), '✅ Run finished: 45 new jobs, none good enough for a CV');
  assert.equal(buildDigest({ ...base, newJobs: 1 }), '✅ Run finished: 1 new job, none good enough for a CV');
});

test('reports a run that found nothing new', () => {
  assert.equal(buildDigest(base), '✅ Run finished: no new jobs');
});

test('does not say "none good enough" when the CV step had problems or was skipped', () => {
  const failed = buildDigest({ ...base, newJobs: 45, errors: ['tailor 1: failed'] });
  assert.match(failed, /45 new jobs, no new CVs/);
  assert.doesNotMatch(failed, /none good enough/);
  assert.equal(buildDigest({ ...base, newJobs: 45, tailorRan: false }), '✅ Run finished: 45 new jobs, no new CVs');
});

test('lists new jobs and links to the dashboard', () => {
  const text = buildDigest({ ...base, newJobs: 9, newlyReady: [job], dashboardUrl: 'https://x.vercel.app' });
  assert.match(text, /1 new job ready/);
  assert.doesNotMatch(text, /Run finished/);
  assert.match(text, /85 – React Developer @ Acme, Dubai/);
  assert.match(text, /href="https:\/\/x\.vercel\.app"/);
});

test('escapes characters Telegram would treat as HTML', () => {
  const text = buildDigest({ ...base, newlyReady: [{ ...job, company: 'R&D <Labs>' }] });
  assert.match(text, /R&amp;D &lt;Labs&gt;/);
});

test('reports quota and other problems without showing their raw text', () => {
  const text = buildDigest({ ...base, errors: ['tailor 1: Gemini free quota reached: secret detail', 'jooble: HTTP 403'] });
  assert.match(text, /free limit ran out/);
  assert.match(text, /1 problem in this run/);
  assert.doesNotMatch(text, /secret detail|jooble/);
});

test('shortens a very long list', () => {
  const text = buildDigest({ ...base, newlyReady: Array.from({ length: 20 }, () => job) });
  assert.match(text, /20 new jobs ready/);
  assert.match(text, /and 5 more/);
});
