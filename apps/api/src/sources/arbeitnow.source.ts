import { fetchJson, htmlToText, toDate } from './http';
import { JobSource, RawJob } from './source.types';

interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags: string[];
  job_types: string[];
  location: string;
  created_at: number;
}

/** Arbeitnow public API (free, no key). Mostly Europe; we keep remote ones. */
export class ArbeitnowSource implements JobSource {
  readonly name = 'arbeitnow';
  readonly label = 'Arbeitnow';
  private readonly pages = 3;

  isEnabled() {
    return process.env.DISABLE_ARBEITNOW !== 'true';
  }

  async fetchJobs(): Promise<RawJob[]> {
    const out: RawJob[] = [];
    for (let page = 1; page <= this.pages; page++) {
      const data = await fetchJson<{ data: ArbeitnowJob[] }>(
        `https://www.arbeitnow.com/api/job-board-api?page=${page}`,
      );
      if (!data.data?.length) break;
      for (const j of data.data) {
        out.push({
          source: this.name,
          externalId: j.slug,
          title: j.title,
          company: j.company_name,
          location: j.remote ? `Remote (${j.location})` : j.location,
          isRemote: j.remote,
          url: j.url,
          description: htmlToText(j.description),
          tags: [...(j.tags ?? []), ...(j.job_types ?? [])],
          postedAt: toDate(j.created_at),
        });
      }
    }
    return out;
  }
}
