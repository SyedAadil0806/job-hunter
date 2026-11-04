import { fetchJson, htmlToText, toDate } from './http';
import { JobSource, RawJob } from './source.types';

interface RemoteOkJob {
  id?: string | number;
  slug?: string;
  position?: string;
  company?: string;
  location?: string;
  description?: string;
  url?: string;
  apply_url?: string;
  date?: string;
  epoch?: number;
  tags?: string[];
  salary_min?: number;
  salary_max?: number;
  legal?: string;
}

/**
 * RemoteOK public API (free, no key). The first array item is a legal notice.
 * Their terms ask you to link back to RemoteOK, which the dashboard does.
 */
export class RemoteOkSource implements JobSource {
  readonly name = 'remoteok';
  readonly label = 'Remote OK';

  isEnabled() {
    return process.env.DISABLE_REMOTEOK !== 'true';
  }

  async fetchJobs(): Promise<RawJob[]> {
    const data = await fetchJson<RemoteOkJob[]>('https://remoteok.com/api', {}, { retries: 1 });
    return data
      .filter((j) => !j.legal && j.id && j.position)
      .map((j) => ({
        source: this.name,
        externalId: String(j.id),
        title: j.position!,
        company: j.company ?? 'Unknown',
        location: j.location || 'Remote',
        isRemote: true,
        url: j.url ?? `https://remoteok.com/remote-jobs/${j.slug ?? j.id}`,
        description: htmlToText(j.description),
        salary:
          j.salary_min && j.salary_max ? `$${j.salary_min.toLocaleString()} - $${j.salary_max.toLocaleString()}` : undefined,
        tags: j.tags ?? [],
        postedAt: toDate(j.epoch ?? j.date),
      }));
  }
}
