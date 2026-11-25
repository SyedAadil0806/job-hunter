import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Cv } from './cv.schema';
import { renderCvPdf } from './pdf.renderer';
import { keywordCoverage } from './ats';
import { atsText, cvPlainText } from './cv.layout';
import { renderCvDocx } from './docx.renderer';
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
  headline: '',
  titleIndex: 1,
  summary: 'Backend-focused developer who builds NestJS APIs on PostgreSQL.',
  skillCategoryOrder: ['Backend', 'Frontend', 'Made Up Category'],
  skillOrder: [
    { category: 'Backend', skills: ['PostgreSQL', 'Kubernetes'] },
    { category: 'Frontend', skills: ['Next.js'] },
  ],
  addedSkills: [
    { category: 'backend', skills: ['Kubernetes', 'PostgreSQL'] },
    { category: 'Cloud', skills: ['AWS', 'Docker'] },
  ],
  experience: [{ index: 0, bullets: ['Delivered 12 client websites', 'Improved load time by 70%'] }],
  projectOrder: [1, 0, 9],
  projects: [{ index: 1, bullets: ['Built B with NestJS'] }],
  coverLetter: 'Dear team, this is a cover letter long enough to pass validation. Thanks, Test',
  keywordsUsed: [],
};

test('reorders skills and adds the ones the job asks for', () => {
  const cv = mergeTailored(base, tailored);
  assert.deepEqual(Object.keys(cv.skills), ['Backend', 'Cloud', 'Frontend']);
  assert.deepEqual(cv.skills.Backend, ['Kubernetes', 'PostgreSQL', 'NestJS']);
  assert.deepEqual(cv.skills.Cloud, ['AWS', 'Docker']);
  assert.deepEqual(cv.addedSkills, ['Kubernetes', 'AWS', 'Docker']);
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

test('uses the job title as headline, or an approved title as backup', () => {
  assert.equal(mergeTailored(base, { ...tailored, headline: 'Junior React Developer' }).title, 'Junior React Developer');
  assert.equal(mergeTailored(base, tailored).title, 'Automation Developer');
  assert.equal(mergeTailored(base, { ...tailored, titleIndex: 7 }).title, 'Full Stack Developer');
});

test('keeps the original bullet if a rewrite drops its number', () => {
  const cv = mergeTailored(base, { ...tailored, experience: [{ index: 0, bullets: ['Delivered client websites', 'Cut load time by 40%'] }] });
  assert.equal(cv.experience[0].bullets[0], 'Built 12 client sites');
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

test('plain text reads in order: title, then company and dates, then bullets', () => {
  const text = cvPlainText(base);
  const order = ['Test Person', 'PROFESSIONAL SUMMARY', 'SKILLS', 'WORK EXPERIENCE', 'Web Developer', 'Co | Jan 2025 - Jun 2026', '- Built 12'];
  let at = -1;
  for (const part of order) {
    const i = text.indexOf(part);
    assert.ok(i > at, `"${part}" is out of order`);
    at = i;
  }
});

test('ATS text uses plain characters', () => {
  assert.equal(atsText('Developer (React · Next.js) — 0–100 “fast” → done 🚀'), 'Developer (React, Next.js) - 0-100 "fast" to done');
  assert.equal(atsText('Café'), 'Café');
});

test('keyword coverage matches common spellings', () => {
  const cv = mergeTailored(base, tailored);
  const c = keywordCoverage(cv, ['ReactJS', 'Node.js', 'nextjs', 'PostgreSQL', 'GraphQL']);
  assert.deepEqual(c.found, ['ReactJS', 'nextjs', 'PostgreSQL']);
  assert.deepEqual(c.missing, ['Node.js', 'GraphQL']);
  assert.equal(c.percent, 60);
});

test('renders a real Word file', async () => {
  const docx = await renderCvDocx(mergeTailored(base, tailored));
  assert.equal(docx.subarray(0, 2).toString(), 'PK');
  assert.ok(docx.length > 3000);
});
