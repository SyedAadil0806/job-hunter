import { fetchJson, htmlToText, toDate } from './http';
import { JobSource, RawJob } from './source.types';

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category: string;
  job_type?: string;
  publication_date: string;
  candidate_required_location: string;
  salary?: string;
  description: string;
  tags?: string[];
}

/**
 * Remotive public API (free, no key).
 * Their terms: fetch at most ~4 times a day and link back to Remotive.
 * So we make ONE request per run (whole software-dev category) and filter locally.
 */
export class RemotiveSource implements JobSource {
  readonly name = 'remotive';
  readonly label = 'Remotive';

  isEnabled() {
    return process.env.DISABLE_REMOTIVE !== 'true';
  }

  async fetchJobs(): Promise<RawJob[]> {
    const data = await fetchJson<{ jobs: RemotiveJob[] }>(
      'https://remotive.com/api/remote-jobs?category=software-dev',
      {},
      { retries: 0, timeoutMs: 30_000 },
    );
    return (data.jobs ?? []).map((j) => ({
      source: this.name,
      externalId: String(j.id),
      title: j.title,
      company: j.company_name,
      location: j.candidate_required_location || 'Remote',
      isRemote: true,
      url: j.url,
      description: htmlToText(j.description),
      salary: j.salary || undefined,
      tags: j.tags ?? [],
      postedAt: toDate(j.publication_date),
    }));
  }
}
