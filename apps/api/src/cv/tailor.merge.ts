import { z } from 'zod';
import { atsText } from './cv.layout';
import { Cv } from './cv.schema';

/** What the AI sends back for one job. */
export const TailoredSchema = z.object({
  /** Headline for this job, usually the job's own title. Empty = use `titleIndex`. */
  headline: z.string().default(''),
  /** Index into [title, ...titleOptions], used when `headline` is empty. */
  titleIndex: z.number().int().min(0).default(0),
  summary: z.string().min(20),
  skillCategoryOrder: z.array(z.string()),
  skillOrder: z.array(z.object({ category: z.string(), skills: z.array(z.string()) })),
  /** Skills and keywords the job asks for that the CV doesn't list yet. */
  addedSkills: z.array(z.object({ category: z.string(), skills: z.array(z.string()) })).default([]),
  experience: z.array(z.object({ index: z.number().int().min(0), bullets: z.array(z.string()) })),
  projectOrder: z.array(z.number().int().min(0)),
  projects: z.array(z.object({ index: z.number().int().min(0), bullets: z.array(z.string()) })),
  coverLetter: z.string().min(50),
  keywordsUsed: z.array(z.string()).default([]),
});
export type Tailored = z.infer<typeof TailoredSchema>;

/** The tailored CV plus what was added for this job, so you know what to prepare. */
export type TailoredCv = Cv & { addedSkills?: string[] };

const numbersIn = (s: string) => new Set(s.match(/\d+(?:[.,]\d+)?%?/g) ?? []);

/**
 * Bullets can be reworded freely, with two limits: no number that isn't in the
 * original entry (made-up metrics fall apart in an interview or reference
 * check), and every number in the original bullet stays (metrics are what
 * recruiters look for).
 */
function safeBullets(original: string[], proposed: string[] | undefined): string[] {
  if (!proposed || proposed.length !== original.length) return original;
  const known = numbersIn(original.join(' '));
  return proposed.map((b, i) => {
    const text = b.trim();
    if (!text) return original[i];
    const nums = numbersIn(text);
    for (const n of nums) if (!known.has(n)) return original[i];
    for (const n of numbersIn(original[i])) if (!nums.has(n)) return original[i];
    return text;
  });
}

const key = (s: string) => s.trim().toLowerCase();
const cleanSkill = (s: string) => atsText(s).replace(/[.;]+$/, '').trim().slice(0, 60);

/** Put the AI's changes on top of the real CV. Employers, roles, dates and education never change. */
export function mergeTailored(base: Cv, t: Tailored): TailoredCv {
  // Skills: reorder what's there, then add what the job asks for.
  const baseCats = Object.keys(base.skills);
  const catOrder = [
    ...t.skillCategoryOrder.filter((c, i, a) => baseCats.includes(c) && a.indexOf(c) === i),
    ...baseCats.filter((c) => !t.skillCategoryOrder.includes(c)),
  ];
  const orderByCat = new Map(t.skillOrder.map((s) => [s.category, s.skills]));
  const skills: Cv['skills'] = {};
  for (const cat of catOrder) {
    const real = base.skills[cat];
    const lower = new Map(real.map((s) => [key(s), s]));
    const ordered: string[] = [];
    for (const s of orderByCat.get(cat) ?? []) {
      const hit = lower.get(key(s));
      if (hit && !ordered.includes(hit)) ordered.push(hit);
    }
    skills[cat] = [...ordered, ...real.filter((s) => !ordered.includes(s))];
  }

  const have = new Set(Object.values(skills).flat().map(key));
  const added: string[] = [];
  const newCats: Cv['skills'] = {};
  for (const group of t.addedSkills) {
    const cat = cleanSkill(group.category) || 'Additional Skills';
    // Match an existing category case-insensitively, so "frontend" joins "Frontend".
    const existing = catOrder.find((c) => key(c) === key(cat));
    const list = existing ? skills[existing] : (newCats[Object.keys(newCats).find((c) => key(c) === key(cat)) ?? cat] ??= []);
    const fresh: string[] = [];
    for (const raw of group.skills) {
      const s = cleanSkill(raw);
      if (!s || have.has(key(s))) continue;
      have.add(key(s));
      fresh.push(s);
    }
    added.push(...fresh);
    // New skills go first in their category: they are what this job asked for.
    list.unshift(...fresh);
  }
  // New categories go right after the most relevant existing one.
  const [firstCat, ...otherCats] = catOrder;
  const allSkills: Cv['skills'] = {};
  if (firstCat) allSkills[firstCat] = skills[firstCat];
  for (const [c, list] of Object.entries(newCats)) if (list.length) allSkills[c] = list;
  for (const c of otherCats) allSkills[c] = skills[c];

  const expByIndex = new Map(t.experience.map((e) => [e.index, e.bullets]));
  const experience = base.experience.map((e, i) => ({ ...e, bullets: safeBullets(e.bullets, expByIndex.get(i)) }));

  const projByIndex = new Map(t.projects.map((p) => [p.index, p.bullets]));
  const validOrder = t.projectOrder.filter((i, k, a) => i < base.projects.length && a.indexOf(i) === k);
  const order = [...validOrder, ...base.projects.map((_, i) => i).filter((i) => !validOrder.includes(i))];
  const projects = order.map((i) => ({ ...base.projects[i], bullets: safeBullets(base.projects[i].bullets, projByIndex.get(i)) }));

  // Headline: the job's own title matches best in ATS searches. It's a target, not a past job.
  const titles = [base.title, ...base.titleOptions];
  const headline = atsText(t.headline).slice(0, 90);
  const title = headline.length >= 3 ? headline : (titles[t.titleIndex] ?? base.title);

  // Summary: no number that appears nowhere in the CV (e.g. "5 years of experience").
  const cvNumbers = numbersIn(JSON.stringify(base));
  const proposedSummary = t.summary.trim().slice(0, 900);
  const summaryOk = [...numbersIn(proposedSummary)].every((n) => cvNumbers.has(n));

  return {
    ...base,
    title,
    summary: summaryOk ? proposedSummary : base.summary,
    skills: allSkills,
    experience,
    projects,
    addedSkills: added,
  };
}
