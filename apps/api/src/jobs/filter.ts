import { SearchConfig } from '../config/search-config.schema';
import { RawJob } from '../sources/source.types';

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(inc|llc|ltd|fz|fze|fzco|fz-llc|gmbh|bv|plc|co)\b\.?/g, ' ')
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Same job posted on two sites gets the same key, so it is stored once. */
export function dedupeKey(job: Pick<RawJob, 'company' | 'title'>): string {
  return `${norm(job.company)}|${norm(job.title)}`.slice(0, 300);
}

const containsAny = (text: string, words: string[]) => {
  const t = text.toLowerCase();
  return words.find((w) => t.includes(w.toLowerCase()));
};

/** Whole words only, so "uae" can't match inside another word. */
const hasWord = (text: string, words: string[]) =>
  words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));

/**
 * Sites sometimes list hybrid jobs as remote. Only phrases that describe how the
 * job is worked count, so "a hybrid split with our cloud" doesn't drop a job.
 */
const HYBRID_IN_DESCRIPTION =
  /\bhybrid\s+(in|role|position|job|work|working|schedule|model|setup|arrangement|policy)\b|\b\d\s*days?\s*(a|per|\/)\s*week\s*(in|at|on|from)\s*(the\s*)?(office|site)\b|\b(in[- ]office|on[- ]site)\s*\d\s*days\b/i;

export type FilterResult = { keep: true } | { keep: false; reason: string };

/**
 * Cheap rules that run before any AI call, so you only pay to score jobs
 * that could actually fit.
 */
export function prefilter(job: RawJob, config: SearchConfig, now = new Date()): FilterResult {
  const title = job.title ?? '';

  if (!containsAny(title, config.titleMustInclude)) {
    return { keep: false, reason: 'title not a target role' };
  }
  const badTitle = containsAny(` ${title} `, config.titleExclude);
  if (badTitle) return { keep: false, reason: `title has "${badTitle.trim()}"` };

  const badDesc = containsAny(job.description, config.descriptionExclude);
  if (badDesc) return { keep: false, reason: `description has "${badDesc}"` };

  if (job.postedAt) {
    const ageDays = (now.getTime() - job.postedAt.getTime()) / 8.64e7;
    if (ageDays > config.limits.maxJobAgeDays) return { keep: false, reason: `older than ${config.limits.maxJobAgeDays} days` };
  }

  // Inside the UAE any setup is fine: on-site, hybrid or remote.
  if (hasWord(job.location, config.onsiteLocations)) return { keep: true };

  // Outside the UAE the job must be truly remote.
  if (!job.isRemote) return { keep: false, reason: 'on-site outside target locations' };
  if (/\bhybrid\b/i.test(`${title} ${job.location}`) || HYBRID_IN_DESCRIPTION.test(job.description)) {
    return { keep: false, reason: 'hybrid outside the UAE' };
  }
  const region = containsAny(job.location, config.remoteRegionExclude);
  if (region) return { keep: false, reason: `remote but "${region}"` };
  return { keep: true };
}
