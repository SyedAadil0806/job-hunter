import { Cv } from './cv.schema';

/**
 * The CV as a flat list of blocks, in the exact order a reader (or an ATS
 * parser) should see them. The PDF and Word renderers both draw this list
 * top to bottom, so the two files always say the same thing in the same order.
 *
 * ATS rules this layout follows:
 * - One column, everything left-aligned, read top to bottom. No right-aligned
 *   dates on the same line as a title: many parsers read those first and
 *   attach them to the wrong job.
 * - Standard section names that parsers look for.
 * - Job title, then company, location and dates on the next line.
 * - Plain characters only (see `atsText`).
 */
export type Block =
  | { kind: 'name'; text: string }
  | { kind: 'headline'; text: string }
  | { kind: 'contact'; parts: { text: string; link?: string }[] }
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'labelled'; label: string; text: string }
  | { kind: 'entry'; title: string; meta: string; bullets: string[] };

const REPLACEMENTS: [RegExp, string][] = [
  [/\s*[·•▪◦●]\s*/g, ', '], // "React · Next.js" -> "React, Next.js"
  [/\s+[—―]\s+/g, ' - '],
  [/[—―‒–−]/g, '-'],
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/…/g, '...'],
  [/→/g, 'to'],
  [/≥/g, '>='],
  [/≤/g, '<='],
  [/[  -​  　]/g, ' '],
  [/[‌‍﻿]/g, ''],
];

/**
 * Plain text that every ATS reads the same way: dashes, quotes and odd symbols
 * become plain ones, and anything outside Latin-1 (emoji, arrows) is dropped.
 * Latin-1 accents like "é" are kept.
 */
export function atsText(s: string): string {
  let out = s;
  for (const [re, to] of REPLACEMENTS) out = out.replace(re, to);
  return out
    .replace(/[^\t\n\x20-\x7e¡-ÿ]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/\(\s*,\s*/g, '(')
    .trim();
}

const dates = (start: string | undefined, end: string) => (start ? `${start} - ${end}` : end);
const join = (parts: (string | undefined)[]) => parts.map((p) => p?.trim()).filter(Boolean).join(' | ');

/** "linkedin.com/in/x" -> "https://linkedin.com/in/x", so the link works when clicked. */
const href = (s: string) => (/^https?:\/\//i.test(s) ? s : `https://${s}`);
/** Shown without "https://": shorter, and parsers find it either way. */
const shown = (s: string) => s.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');

export function cvBlocks(cv: Cv): Block[] {
  const t = atsText;
  const c = cv.contact;
  const blocks: Block[] = [
    { kind: 'name', text: t(cv.name) },
    { kind: 'headline', text: t(cv.title) },
  ];

  const line1: { text: string; link?: string }[] = [c.location, c.phone].filter(Boolean).map((s) => ({ text: t(s!) }));
  line1.push({ text: t(c.email), link: `mailto:${c.email.trim()}` });
  blocks.push({ kind: 'contact', parts: line1 });
  const line2 = [c.linkedin, c.github, c.portfolio].filter(Boolean).map((s) => ({ text: t(shown(s!)), link: href(s!.trim()) }));
  if (line2.length) blocks.push({ kind: 'contact', parts: line2 });

  blocks.push({ kind: 'heading', text: 'Professional Summary' }, { kind: 'paragraph', text: t(cv.summary) });

  const skillRows = Object.entries(cv.skills).filter(([, list]) => list.length);
  if (skillRows.length) {
    blocks.push({ kind: 'heading', text: 'Skills' });
    for (const [cat, list] of skillRows) blocks.push({ kind: 'labelled', label: t(cat), text: t(list.join(', ')) });
  }

  if (cv.experience.length) {
    blocks.push({ kind: 'heading', text: 'Work Experience' });
    for (const e of cv.experience) {
      blocks.push({ kind: 'entry', title: t(e.role), meta: t(join([e.company, e.location, dates(e.start, e.end)])), bullets: e.bullets.map(t) });
    }
  }

  if (cv.projects.length) {
    blocks.push({ kind: 'heading', text: 'Projects' });
    for (const p of cv.projects) {
      const meta = join([p.stack.length ? `Technologies: ${p.stack.join(', ')}` : undefined, p.link && shown(p.link)]);
      blocks.push({ kind: 'entry', title: t(p.name), meta: t(meta), bullets: p.bullets.map(t) });
    }
  }

  if (cv.education.length) {
    blocks.push({ kind: 'heading', text: 'Education' });
    for (const e of cv.education) {
      blocks.push({ kind: 'entry', title: t(e.degree), meta: t(join([e.school, e.location, dates(e.start, e.end)])), bullets: e.details.map(t) });
    }
  }

  if (cv.certifications.length) {
    blocks.push({ kind: 'heading', text: 'Certifications' });
    for (const cert of cv.certifications) blocks.push({ kind: 'entry', title: t(cert), meta: '', bullets: [] });
  }

  return blocks;
}

/** The whole CV as plain text in reading order: what an ATS should extract. */
export function cvPlainText(cv: Cv): string {
  return cvBlocks(cv)
    .map((b) => {
      switch (b.kind) {
        case 'contact':
          return b.parts.map((p) => p.text).join(' | ');
        case 'heading':
          return `\n${b.text.toUpperCase()}`;
        case 'labelled':
          return `${b.label}: ${b.text}`;
        case 'entry':
          return [b.title, b.meta, ...b.bullets.map((x) => `- ${x}`)].filter(Boolean).join('\n');
        default:
          return b.text;
      }
    })
    .join('\n');
}
