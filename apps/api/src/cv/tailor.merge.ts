import { z } from 'zod';
import { Cv } from './cv.schema';

/** What the AI sends back. It only rewords and reorders; it never adds facts. */
export const TailoredSchema = z.object({
  /** Index into [title, ...titleOptions]. */
  titleIndex: z.number().int().min(0).default(0),
  summary: z.string().min(20),
  skillCategoryOrder: z.array(z.string()),
  skillOrder: z.array(z.object({ category: z.string(), skills: z.array(z.string()) })),
  experience: z.array(z.object({ index: z.number().int().min(0), bullets: z.array(z.string()) })),
  projectOrder: z.array(z.number().int().min(0)),
  projects: z.array(z.object({ index: z.number().int().min(0), bullets: z.array(z.string()) })),
  coverLetter: z.string().min(50),
  keywordsUsed: z.array(z.string()).default([]),
});
export type Tailored = z.infer<typeof TailoredSchema>;

const numbersIn = (s: string) => new Set(s.match(/\d+(?:[.,]\d+)?%?/g) ?? []);

/**
 * A reworded bullet is only accepted if every number in it also appears in
 * the original bullets for that entry. This blocks made-up metrics like
 * "improved speed by 70%" when you never said 70%.
 */
function safeBullets(original: string[], proposed: string[] | undefined): string[] {
  if (!proposed || proposed.length !== original.length) return original;
  const known = numbersIn(original.join(' '));
  return proposed.map((b, i) => {
    const text = b.trim();
    if (!text) return original[i];
    for (const n of numbersIn(text)) if (!known.has(n)) return original[i];
    return text;
  });
}

/** Put the AI's reordering on top of the real CV, keeping only real data. */
export function mergeTailored(base: Cv, t: Tailored): Cv {
  // Skills: reorder categories and skills, but keep exactly the real set.
  const baseCats = Object.keys(base.skills);
  const catOrder = [
    ...t.skillCategoryOrder.filter((c, i, a) => baseCats.includes(c) && a.indexOf(c) === i),
    ...baseCats.filter((c) => !t.skillCategoryOrder.includes(c)),
  ];
  const orderByCat = new Map(t.skillOrder.map((s) => [s.category, s.skills]));
  const skills: Cv['skills'] = {};
  for (const cat of catOrder) {
    const real = base.skills[cat];
    const lower = new Map(real.map((s) => [s.toLowerCase(), s]));
    const ordered: string[] = [];
    for (const s of orderByCat.get(cat) ?? []) {
      const hit = lower.get(s.toLowerCase());
      if (hit && !ordered.includes(hit)) ordered.push(hit);
    }
    skills[cat] = [...ordered, ...real.filter((s) => !ordered.includes(s))];
  }

  const expByIndex = new Map(t.experience.map((e) => [e.index, e.bullets]));
  const experience = base.experience.map((e, i) => ({ ...e, bullets: safeBullets(e.bullets, expByIndex.get(i)) }));

  const projByIndex = new Map(t.projects.map((p) => [p.index, p.bullets]));
  const validOrder = t.projectOrder.filter((i, k, a) => i < base.projects.length && a.indexOf(i) === k);
  const order = [...validOrder, ...base.projects.map((_, i) => i).filter((i) => !validOrder.includes(i))];
  const projects = order.map((i) => ({ ...base.projects[i], bullets: safeBullets(base.projects[i].bullets, projByIndex.get(i)) }));

  // Title: only one of the titles you approved.
  const titles = [base.title, ...base.titleOptions];
  const title = titles[t.titleIndex] ?? base.title;

  // Summary: same "no new numbers" rule, checked against the whole CV.
  const cvNumbers = numbersIn(JSON.stringify(base));
  const proposedSummary = t.summary.trim().slice(0, 700);
  const summaryOk = [...numbersIn(proposedSummary)].every((n) => cvNumbers.has(n));

  return {
    ...base,
    title,
    summary: summaryOk ? proposedSummary : base.summary,
    skills,
    experience,
    projects,
  };
}
