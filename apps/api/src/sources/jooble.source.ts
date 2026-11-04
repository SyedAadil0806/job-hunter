import { SearchConfig } from '../config/search-config.schema';
import { fetchJson, htmlToText, toDate } from './http';
import { JobSource, RawJob, REMOTE_WORDS } from './source.types';

interface JoobleJob {
  id: number | string;
  title: string;
  location: string;
  snippet: string;
  salary: string;
  source: string;
  type: string;
  link: string;
  company: string;
  updated: string;
}

/**
 * Jooble API (free key at jooble.org/api/about). Covers the UAE.
 * Note: Jooble only returns a short snippet, not the full description,
 * so scores for Jooble jobs are a bit less precise.
 */
export class JoobleSource implements JobSource {
  readonly name = 'jooble';
  readonly label = 'Jooble';

  isEnabled() {
    return Boolean(process.env.JOOBLE_API_KEY);
  }

  async fetchJobs(config: SearchConfig): Promise<RawJob[]> {
    const host = process.env.JOOBLE_HOST ?? 'jooble.org';
    const out: RawJob[] = [];
    for (const location of config.joobleLocations) {
      for (const keywords of config.queries) {
        const data = await fetchJson<{ jobs: JoobleJob[] }>(`https://${host}/api/${process.env.JOOBLE_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(location === 'Remote' ? { keywords: `${keywords} remote`, location: '', page: 1 } : { keywords, location, page: 1 }),
        });
        for (const j of data.jobs ?? []) {
          // Searching for "remote" also returns on-site jobs, so check each job's own details.
          const isRemote = REMOTE_WORDS.test(`${j.title} ${j.location} ${j.type}`);
          out.push({
            source: this.name,
            externalId: String(j.id),
            title: htmlToText(j.title),
            company: j.company || 'Unknown',
            location: j.location || location,
            isRemote,
            url: j.link,
            description: htmlToText(j.snippet),
            salary: j.salary || undefined,
            tags: j.type ? [j.type] : [],
            postedAt: toDate(j.updated),
          });
        }
      }
    }
    return out;
  }
}
