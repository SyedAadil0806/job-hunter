import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { htmlToText, USER_AGENT } from '../sources/http';

export type LinkState = 'open' | 'closed' | 'unknown';

export const UNVERIFIED_FLAG = "Couldn't confirm this job is still open. Check the link before applying.";

const CLOSED_TEXT = new RegExp(
  [
    'no longer (available|accepting|active|open|taking applications)',
    'not accepting applications',
    '(position|job|vacancy|role|posting|listing|job post)( has been| has| is| was)? (filled|closed|expired|removed)',
    'position is probably filled',
    'applications? (are |is )?closed',
    'job not found',
    'has expired',
    'nicht mehr verfügbar',
    'stelle ist nicht mehr',
  ].join('|'),
  'i',
);
const BOT_WALL_TEXT = /just a moment|verify you are human|checking your browser/i;

/** Only says "closed" on clear proof. Blocked or unreadable pages stay "unknown", never "closed". */
export function classifyPage(status: number, finalUrl: string, html: string): LinkState {
  if (status === 404 || status === 410) return 'closed';
  if (status !== 200) return 'unknown';
  if (/[?&]error=true\b/.test(finalUrl)) return 'closed'; // Greenhouse sends closed jobs here
  const text = htmlToText(html); // drops scripts, whose text never reaches the reader
  if (BOT_WALL_TEXT.test(text)) return 'unknown';
  if (CLOSED_TEXT.test(text)) return 'closed';
  if (text.length < 300) return 'unknown'; // page is built by JavaScript, so we can't read it
  return 'open';
}

async function checkLink(url: string): Promise<LinkState> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(8_000),
    });
    return classifyPage(res.status, res.url, await res.text());
  } catch {
    return 'unknown';
  }
}

const MAX_CHECKS_PER_RUN = 100;
const AT_ONCE = 5;

@Injectable()
export class LivenessService {
  private readonly log = new Logger(LivenessService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Removes jobs that are closed or too old. Returns the ids that were checked, by result. */
  async removeDeadJobs(maxAgeDays: number) {
    const jobs = await this.prisma.job.findMany({
      where: { status: { in: ['NEW', 'SCORED', 'READY'] } },
      orderBy: [{ score: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: MAX_CHECKS_PER_RUN,
      select: { id: true, url: true, postedAt: true, createdAt: true },
    });
    const oldest = Date.now() - maxAgeDays * 8.64e7;
    const remove = (id: string, filterReason: string) =>
      this.prisma.job.update({ where: { id }, data: { status: 'FILTERED', filterReason } });

    const result = { closed: 0, expired: 0, open: [] as string[], unknown: [] as string[] };
    for (let i = 0; i < jobs.length; i += AT_ONCE) {
      await Promise.all(
        jobs.slice(i, i + AT_ONCE).map(async (job) => {
          if ((job.postedAt ?? job.createdAt).getTime() < oldest) {
            await remove(job.id, `older than ${maxAgeDays} days`);
            result.expired += 1;
            return;
          }
          const state = await checkLink(job.url);
          if (state === 'closed') {
            await remove(job.id, 'job is no longer open');
            result.closed += 1;
          } else {
            result[state].push(job.id);
          }
        }),
      );
    }
    this.log.log(`links: ${result.open.length} open, ${result.closed} closed, ${result.expired} too old, ${result.unknown.length} unconfirmed`);
    return result;
  }

  /** Adds or removes the warning shown on the job card. Runs after scoring, which rewrites redFlags. */
  async updateWarnings(checked: { open: string[]; unknown: string[] }) {
    const unknown = new Set(checked.unknown);
    const jobs = await this.prisma.job.findMany({
      where: { id: { in: [...checked.open, ...checked.unknown] }, status: { in: ['SCORED', 'READY'] } },
      select: { id: true, redFlags: true },
    });
    for (const job of jobs) {
      const others = job.redFlags.filter((f) => f !== UNVERIFIED_FLAG);
      const wanted = unknown.has(job.id) ? [...others, UNVERIFIED_FLAG] : others;
      if (wanted.length !== job.redFlags.length) {
        await this.prisma.job.update({ where: { id: job.id }, data: { redFlags: wanted } });
      }
    }
  }
}
