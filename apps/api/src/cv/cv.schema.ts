import { z } from 'zod';

/**
 * The shape of your CV. Your real CV lives in cv/base-cv.json
 * (or in the BASE_CV_JSON env var / GitHub secret, so it never goes in git).
 */
export const ExperienceSchema = z.object({
  role: z.string(),
  company: z.string(),
  location: z.string().optional(),
  /** Leave out for a single-year entry like "2021". */
  start: z.string().optional(),
  end: z.string(),
  bullets: z.array(z.string()).min(1),
});

export const ProjectSchema = z.object({
  name: z.string(),
  stack: z.array(z.string()).default([]),
  link: z.string().optional(),
  bullets: z.array(z.string()).min(1),
});

export const EducationSchema = z.object({
  degree: z.string(),
  school: z.string(),
  location: z.string().optional(),
  start: z.string().optional(),
  end: z.string(),
  details: z.array(z.string()).default([]),
});

export const CvSchema = z.object({
  name: z.string(),
  title: z.string(),
  /**
   * Other headlines you are happy to use. For each job the AI picks the best
   * one from `title` + these. It can never write a new title.
   */
  titleOptions: z.array(z.string()).default([]),
  contact: z.object({
    email: z.string(),
    phone: z.string().optional(),
    location: z.string().optional(),
    linkedin: z.string().optional(),
    github: z.string().optional(),
    portfolio: z.string().optional(),
  }),
  summary: z.string(),
  /** e.g. { "Frontend": ["React", "Next.js"], "Backend": ["NestJS"] } */
  skills: z.record(z.string(), z.array(z.string())),
  experience: z.array(ExperienceSchema),
  projects: z.array(ProjectSchema).default([]),
  education: z.array(EducationSchema).default([]),
  certifications: z.array(z.string()).default([]),
});

export type Cv = z.infer<typeof CvSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Project = z.infer<typeof ProjectSchema>;

/** Every skill in the CV, lower-cased, for "no invented skills" checks. */
export function allSkills(cv: Cv): Set<string> {
  const set = new Set<string>();
  for (const list of Object.values(cv.skills)) list.forEach((s) => set.add(s.trim().toLowerCase()));
  for (const p of cv.projects) p.stack.forEach((s) => set.add(s.trim().toLowerCase()));
  return set;
}
