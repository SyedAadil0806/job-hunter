import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Cv } from './cv.schema';
import { renderCvPdf } from './pdf.renderer';
import { mergeTailored, Tailored } from './tailor.merge';

const base: Cv = {
  name: 'Test Person',
  title: 'Full Stack Developer',
  titleOptions: ['Automation Developer'],
  contact: { email: 't@example.com', location: 'Sharjah, UAE' },
  summary: 'Original summary.',
  skills: { Frontend: ['React', 'Next.js'], Backend: ['NestJS', 'PostgreSQL'] },
  experience: [
    { role: 'Web Developer', company: 'Co', start: 'Jan 2025', end: 'Jun 2026', bullets: ['Built 12 client sites', 'Cut load time by 40%'] },
  ],
  projects: [
    { name: 'A', stack: ['React'], bullets: ['Did A'] },
    { name: 'B', stack: ['NestJS'], bullets: ['Did B'] },
  ],
  education: [],
  certifications: [],
};

const tailored: Tailored = {
  titleIndex: 1,
  summary: 'Backend-focused developer who builds NestJS APIs on PostgreSQL.',
  skillCategoryOrder: ['Backend', 'Frontend', 'Made Up Category'],
  skillOrder: [
    { category: 'Backend', skills: ['PostgreSQL', 'Kubernetes'] },
    { category: 'Frontend', skills: ['Next.js'] },
  ],
  experience: [{ index: 0, bullets: ['Delivered 12 client websites', 'Improved load time by 70%'] }],
  projectOrder: [1, 0, 9],
  projects: [{ index: 1, bullets: ['Built B with NestJS'] }],
  coverLetter: 'Dear team, this is a cover letter long enough to pass validation. Thanks, Test',
  keywordsUsed: [],
};

test('reorders skills without adding invented ones', () => {
  const cv = mergeTailored(base, tailored);
  assert.deepEqual(Object.keys(cv.skills), ['Backend', 'Frontend']);
  assert.deepEqual(cv.skills.Backend, ['PostgreSQL', 'NestJS']);
  assert.ok(!JSON.stringify(cv).includes('Kubernetes'));
});

test('rejects bullets with made-up numbers, keeps honest rewrites', () => {
  const cv = mergeTailored(base, tailored);
  assert.equal(cv.experience[0].bullets[0], 'Delivered 12 client websites');
  assert.equal(cv.experience[0].bullets[1], 'Cut load time by 40%');
});

test('reorders projects and ignores bad indexes', () => {
  const cv = mergeTailored(base, tailored);
  assert.deepEqual(cv.projects.map((p) => p.name), ['B', 'A']);
  assert.equal(cv.projects[0].bullets[0], 'Built B with NestJS');
});

test('picks only an approved title', () => {
  assert.equal(mergeTailored(base, tailored).title, 'Automation Developer');
  assert.equal(mergeTailored(base, { ...tailored, titleIndex: 7 }).title, 'Full Stack Developer');
});

test('rejects a summary with made-up numbers', () => {
  const cv = mergeTailored(base, { ...tailored, summary: 'Developer with 5 years of NestJS experience building APIs.' });
  assert.equal(cv.summary, 'Original summary.');
  const ok = mergeTailored(base, { ...tailored, summary: 'Developer who delivered 12 client sites and cut load time 40%.' });
  assert.match(ok.summary, /12 client sites/);
});

test('renders a real PDF', async () => {
  const pdf = await renderCvPdf(mergeTailored(base, tailored));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 1500);
});
