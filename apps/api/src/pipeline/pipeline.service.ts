import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { ScoringService } from '../ai/scoring.service';
import { TailoringService } from '../ai/tailoring.service';
import { loadBaseCv, loadSearchConfig } from '../config/profile.loader';
import { CollectorService } from '../jobs/collector.service';
import { LivenessService } from '../jobs/liveness.service';
import { PrismaService } from '../prisma/prisma.service';

export type Step = 'collect' | 'score' | 'tailor';

@Injectable()
export class PipelineService {
  private readonly log = new Logger(PipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly collector: CollectorService,
    private readonly liveness: LivenessService,
    private readonly scoring: ScoringService,
    private readonly tailoring: TailoringService,
    private readonly ai: AiService,
  ) {}

  /** The daily run: collect -> score -> tailor. Each step is optional. */
  async run(steps: Step[] = ['collect', 'score', 'tailor']) {
    const config = loadSearchConfig();
    loadBaseCv(); // fail early with a clear message if the CV is missing or invalid
    const run = await this.prisma.pipelineRun.create({ data: {} });
    const errors: string[] = [];
    const stats = { collected: 0, newJobs: 0, filtered: 0, scored: 0, tailored: 0 };

    try {
      if (steps.includes('collect')) {
        const c = await this.collector.collect();
        Object.assign(stats, { collected: c.collected, newJobs: c.newJobs, filtered: c.filtered });
        errors.push(...c.errors);
      }

      const aiSteps = steps.filter((s) => s !== 'collect');
      if (aiSteps.length && !this.ai.isEnabled()) {
        errors.push(`${this.ai.disabledReason()}: skipped scoring and tailoring`);
      } else {
        if (steps.includes('score')) {
          // Check links first, so no AI quota is spent on closed jobs.
          const links = await this.liveness.removeDeadJobs(config.limits.maxJobAgeDays);
          const s = await this.scoring.scorePending(config.limits.maxScorePerRun);
          stats.scored = s.scored;
          errors.push(...s.errors);
          await this.liveness.updateWarnings(links);
        }
        if (steps.includes('tailor')) {
          const t = await this.tailoring.tailorTop(config.limits.maxTailorPerRun, config.limits.minScoreToTailor);
          stats.tailored = t.tailored;
          errors.push(...t.errors);
        }
      }
    } catch (e) {
      errors.push(`fatal: ${(e as Error).message}`);
      throw e;
    } finally {
      await this.prisma.pipelineRun.update({
        where: { id: run.id },
        data: { ...stats, errors: errors.slice(0, 50), finishedAt: new Date() },
      });
    }

    const ready = await this.prisma.job.findMany({
      where: { status: 'READY' },
      orderBy: { score: 'desc' },
      take: 15,
      select: { title: true, company: true, location: true, score: true, url: true },
    });
    const newlyReady = await this.prisma.job.findMany({
      where: { status: 'READY', cvVersions: { some: { createdAt: { gte: run.startedAt } } } },
      orderBy: { score: 'desc' },
      select: { title: true, company: true, location: true, score: true },
    });
    this.log.log(`done: ${JSON.stringify(stats)}${errors.length ? `, ${errors.length} warnings` : ''}`);
    return { ...stats, errors, ready, newlyReady };
  }
}
