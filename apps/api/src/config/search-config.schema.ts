import { z } from 'zod';

/** What jobs to look for. Edit cv/search-config.json to change it. */
export const SearchConfigSchema = z.object({
  /** Search terms sent to each job site. */
  queries: z.array(z.string()).min(1),
  /** A job title must contain at least one of these (case-insensitive). */
  titleMustInclude: z.array(z.string()).min(1),
  /** Drop jobs whose title contains any of these (e.g. "senior"). */
  titleExclude: z.array(z.string()).default([]),
  /** Drop jobs whose description contains any of these (e.g. "US citizens only"). */
  descriptionExclude: z.array(z.string()).default([]),
  /** On-site / hybrid jobs are kept only if their location matches one of these. */
  onsiteLocations: z.array(z.string()).default([]),
  /** Remote jobs are dropped if their allowed regions say only one of these. */
  remoteRegionExclude: z.array(z.string()).default([]),
  /** Google Jobs (SerpApi) locations to search. */
  googleLocations: z.array(z.string()).default(['United Arab Emirates']),
  /** Adzuna country codes (Adzuna does not cover the UAE). */
  adzunaCountries: z.array(z.string()).default(['gb']),
  /** Jooble locations. Empty string = anywhere. */
  joobleLocations: z.array(z.string()).default(['Dubai']),
  limits: z.object({
    /** Max jobs scored by the AI per run (controls cost / free quota). */
    maxScorePerRun: z.number().int().positive().default(60),
    /** Max CVs tailored per run (controls cost). */
    maxTailorPerRun: z.number().int().nonnegative().default(10),
    /** Only tailor jobs with at least this score (0-100). */
    minScoreToTailor: z.number().int().min(0).max(100).default(70),
    /** Ignore jobs older than this many days. */
    maxJobAgeDays: z.number().int().positive().default(21),
  }),
});

export type SearchConfig = z.infer<typeof SearchConfigSchema>;
