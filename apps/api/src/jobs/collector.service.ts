import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { loadSearchConfig } from '../config/profile.loader';
import { PrismaService } from '../prisma/prisma.service';
import { allSources, JobSource, RawJob } from '../sources';
import { dedupeKey, prefilter } from './filter';

export interface CollectResult {
  collected: number;
  newJobs: number;
  filtered: number;
  errors: string[];
}

@Injectable()
export class CollectorService {
  private readonly log = new Logger(CollectorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Pull jobs from every enabled source, filter them, and store the new ones. */
  async collect(sources: JobSource[] = allSources()): Promise<CollectResult> {
    const config = loadSearchConfig();
    const result: CollectResult = { collected: 0, newJobs: 0, filtered: 0, errors: [] };

    for (const source of sources) {
      if (!source.isEnabled()) {
        this.log.log(`skip ${source.name} (not configured)`);
        continue;
      }
      let jobs: RawJob[];
      try {
        jobs = await source.fetchJobs(config);
        this.log.log(`${source.name}: ${jobs.length} jobs`);
      } catch (e) {
        const msg = `${source.name}: ${(e as Error).message}`;
        this.log.warn(msg);
        result.errors.push(msg);
        continue;
      }
      result.collected += jobs.length;

      for (const job of jobs) {
        if (!job.title || !job.url) continue;
        const key = dedupeKey(job);
        const check = prefilter(job, config);
        try {
          await this.prisma.job.create({
            data: {
              ...job,
              title: job.title.slice(0, 300),
              company: job.company.slice(0, 200),
              location: job.location.slice(0, 300),
              description: job.description.slice(0, 20_000),
              dedupeKey: key,
              status: check.keep ? 'NEW' : 'FILTERED',
              filterReason: check.keep ? null : check.reason,
            },
          });
          result.newJobs += 1;
          if (!check.keep) result.filtered += 1;
        } catch (e) {
          // P2002 = unique constraint: we already have this job. That is normal.
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
          throw e;
        }
      }
    }
    return result;
  }
}
