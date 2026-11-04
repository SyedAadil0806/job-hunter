import { SearchConfig } from '../config/search-config.schema';
import { fetchJson, htmlToText, toDate } from './http';
import { JobSource, RawJob, REMOTE_WORDS } from './source.types';

interface AdzunaJob {
  id: string;
  title: string;
  description: string;
  redirect_url: string;
  created: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  salary_min?: number;
  salary_max?: number;
}

/** Adzuna has no remote field. "Remote" alone in a description proves nothing ("remote meetings"). */
const REMOTE_STATED = /\b(fully|completely|entirely)\s+remote\b|100%\s+remote\b|\bremote[- ](first|only|position|role|job)\b|\bwork from anywhere\b/i;

/**
 * Adzuna API (free key at developer.adzuna.com). Does not cover the UAE,
 * so we search the countries in adzunaCountries for REMOTE roles only.
 */
export class AdzunaSource implements JobSource {
  readonly name = 'adzuna';
  readonly label = 'Adzuna';

  isEnabled() {
    return Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
  }

  async fetchJobs(config: SearchConfig): Promise<RawJob[]> {
    const out: RawJob[] = [];
    for (const country of config.adzunaCountries) {
      for (const query of config.queries) {
        const params = new URLSearchParams({
          app_id: process.env.ADZUNA_APP_ID!,
          app_key: process.env.ADZUNA_APP_KEY!,
          what: `${query} remote`,
          results_per_page: '30',
          max_days_old: String(config.limits.maxJobAgeDays),
          'content-type': 'application/json',
        });
        const data = await fetchJson<{ results: AdzunaJob[] }>(
          `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`,
        );
        for (const j of data.results ?? []) {
          const place = j.location?.display_name ?? '';
          out.push({
            source: this.name,
            externalId: `${country}-${j.id}`,
            title: htmlToText(j.title),
            company: j.company?.display_name ?? 'Unknown',
            location: j.location?.display_name ?? country.toUpperCase(),
            isRemote: REMOTE_WORDS.test(`${j.title} ${place}`) || REMOTE_STATED.test(j.description),
            url: j.redirect_url,
            description: htmlToText(j.description),
            salary: j.salary_min && j.salary_max ? `${j.salary_min} - ${j.salary_max}` : undefined,
            tags: [],
            postedAt: toDate(j.created),
          });
        }
      }
    }
    return out;
  }
}
