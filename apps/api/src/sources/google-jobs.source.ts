import { SearchConfig } from '../config/search-config.schema';
import { fetchJson, relativeToDate } from './http';
import { JobSource, RawJob, REMOTE_WORDS } from './source.types';

interface GoogleJob {
  job_id: string;
  title: string;
  company_name: string;
  location?: string;
  via?: string;
  description?: string;
  share_link?: string;
  extensions?: string[];
  detected_extensions?: {
    posted_at?: string;
    schedule_type?: string;
    work_from_home?: boolean;
    salary?: string;
  };
  apply_options?: { title: string; link: string }[];
}

const BIG_BOARDS = /linkedin|indeed|glassdoor|bayt|gulftalent|naukrigulf/i;
const COPY_SITES = /jooble|jobrapido|expertini|learn4good|bebee|hirelala|jobilize|whatjobs|talent\.com|jobgether|jora\b/i;

/** SerpApi often leaves detected_extensions empty and only fills the plain extensions list. */
function readExtensions(j: GoogleJob) {
  const list = j.extensions ?? [];
  const found = (pattern: RegExp) => list.find((e) => pattern.test(e));
  const det = j.detected_extensions ?? {};
  return {
    posted_at: det.posted_at ?? found(/\bago\b|\btoday\b|\bjust\b/i),
    schedule_type: det.schedule_type ?? found(/full.?time|part.?time|contract|intern|temporary/i),
    work_from_home: det.work_from_home ?? Boolean(found(/work from home|remote/i)),
    salary: det.salary ?? found(/\ban? (hour|day|week|month|year)\b/i),
  };
}

/**
 * Google Jobs through SerpApi (serpapi.com, free plan has a small monthly
 * search limit). Google Jobs pulls listings from LinkedIn, Bayt, GulfTalent,
 * company career pages and more, so this is how LinkedIn jobs show up
 * without scraping LinkedIn.
 *
 * Each query x location = 1 SerpApi search. Keep queries/locations small
 * or set GOOGLE_MAX_SEARCHES_PER_RUN to stay inside the free plan.
 */
export class GoogleJobsSource implements JobSource {
  readonly name = 'google';
  readonly label = 'Google Jobs';

  isEnabled() {
    return Boolean(process.env.SERPAPI_KEY);
  }

  async fetchJobs(config: SearchConfig): Promise<RawJob[]> {
    const maxSearches = Number(process.env.GOOGLE_MAX_SEARCHES_PER_RUN ?? 3);
    const combos = config.googleLocations.flatMap((location) => config.queries.map((q) => ({ q, location })));
    // Rotate through the combos day by day so all queries get used over a week.
    const day = Math.floor(Date.now() / 8.64e7);
    const picked = Array.from({ length: Math.min(maxSearches, combos.length) }, (_, i) => combos[(day * maxSearches + i) % combos.length]);

    const out: RawJob[] = [];
    for (const { q, location } of picked) {
      const params = new URLSearchParams({
        engine: 'google_jobs',
        q,
        location,
        hl: 'en',
        api_key: process.env.SERPAPI_KEY!,
      });
      const data = await fetchJson<{ jobs_results?: GoogleJob[] }>(`https://serpapi.com/search.json?${params}`);
      for (const j of data.jobs_results ?? []) {
        const ext = readExtensions(j);
        // Company site first, then big job boards. Sites that copy other boards' posts go last,
        // because their links go stale most often.
        const apply = j.apply_options ?? [];
        const best =
          apply.find((a) => !BIG_BOARDS.test(a.title) && !COPY_SITES.test(a.title)) ??
          apply.find((a) => BIG_BOARDS.test(a.title)) ??
          apply[0];
        out.push({
          source: this.name,
          externalId: j.job_id.slice(0, 180),
          title: j.title,
          company: j.company_name,
          location: j.location ?? location,
          isRemote: Boolean(ext.work_from_home) || REMOTE_WORDS.test(`${j.title} ${j.location ?? ''}`),
          url: best?.link ?? j.share_link ?? '',
          description: j.description ?? '',
          salary: ext.salary,
          tags: [ext.schedule_type, j.via].filter((t): t is string => Boolean(t)),
          postedAt: relativeToDate(ext.posted_at),
        });
      }
    }
    return out.filter((j) => j.url);
  }
}
