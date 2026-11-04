import { Injectable, Logger } from '@nestjs/common';
import { Job } from '@prisma/client';
import { z } from 'zod';
import { loadBaseCv } from '../config/profile.loader';
import { Cv } from '../cv/cv.schema';
import { PrismaService } from '../prisma/prisma.service';
import { AiService, isQuotaError } from './ai.service';

export const ScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  reason: z.string(),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  redFlags: z.array(z.string()),
});
export type Score = z.infer<typeof ScoreSchema>;

const SCORE_JSON_SCHEMA = {
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100, description: 'How good a fit this job is for the candidate.' },
    reason: { type: 'string', description: 'One or two plain sentences explaining the score.' },
    matchedSkills: { type: 'array', items: { type: 'string' }, description: 'Skills the job wants that the candidate has.' },
    missingSkills: { type: 'array', items: { type: 'string' }, description: 'Important skills the job wants that the candidate lacks.' },
    redFlags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Deal-breakers: needs many more years, region lock, unpaid, visa/citizenship requirement, etc.',
    },
  },
  required: ['score', 'reason', 'matchedSkills', 'missingSkills', 'redFlags'],
};

const SYSTEM = `You screen job posts for one job seeker. Be strict and realistic.
Scoring guide:
- 85-100: strong fit. Seniority matches (entry/junior/mid with <=2 yrs), most core skills match.
- 70-84: good fit. Worth applying, a few gaps.
- 50-69: stretch. Big skill gaps or slightly too senior.
- 0-49: poor fit or a deal-breaker (e.g. 5+ years required, region-locked to a country the candidate can't work in, unrelated stack).
The candidate is based in the UAE. Remote roles open to the UAE/worldwide are fine.
Only list skills that appear in the job post. Never assume the candidate has a skill not in their CV.`;

/** A short text version of the CV, so scoring prompts stay cheap. */
export function cvForScoring(cv: Cv): string {
  const skills = Object.entries(cv.skills)
    .map(([k, v]) => `${k}: ${v.join(', ')}`)
    .join('\n');
  const exp = cv.experience.map((e) => `- ${e.role} at ${e.company} (${[e.start, e.end].filter(Boolean).join(' - ')})`).join('\n');
  const projects = cv.projects.map((p) => `- ${p.name} [${p.stack.join(', ')}]`).join('\n');
  const edu = cv.education.map((e) => `- ${e.degree}, ${e.school} (${e.end})`).join('\n');
  return [
    `Title: ${cv.title}`,
    `Location: ${cv.contact.location ?? 'UAE'}`,
    `Skills:\n${skills}`,
    `Experience:\n${exp}`,
    projects && `Projects:\n${projects}`,
    edu && `Education:\n${edu}`,
    cv.certifications.length ? `Certifications: ${cv.certifications.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function jobForPrompt(job: Pick<Job, 'title' | 'company' | 'location' | 'isRemote' | 'description' | 'salary'>, maxChars = 6000) {
  return [
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location}${job.isRemote ? ' (remote)' : ''}`,
    job.salary ? `Salary: ${job.salary}` : '',
    `Description:\n${job.description.slice(0, maxChars)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

@Injectable()
export class ScoringService {
  private readonly log = new Logger(ScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async scoreJob(job: Job, cv: Cv = loadBaseCv()): Promise<Score> {
    const score = await this.ai.structured({
      task: 'score',
      system: SYSTEM,
      prompt: `<candidate>\n${cvForScoring(cv)}\n</candidate>\n\n<job>\n${jobForPrompt(job)}\n</job>\n\nScore this job for the candidate.`,
      name: 'record_score',
      description: 'How well the job fits the candidate.',
      schema: SCORE_JSON_SCHEMA,
      validator: ScoreSchema,
      maxTokens: 800,
    });

    await this.prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'SCORED',
        score: score.score,
        scoreReason: score.reason,
        matchedSkills: score.matchedSkills,
        missingSkills: score.missingSkills,
        redFlags: score.redFlags,
        scoredAt: new Date(),
      },
    });
    return score;
  }

  /** Score the newest unscored jobs, up to `limit`. */
  async scorePending(limit: number): Promise<{ scored: number; errors: string[] }> {
    const jobs = await this.prisma.job.findMany({
      where: { status: 'NEW' },
      orderBy: [{ postedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: limit,
    });
    const cv = loadBaseCv();
    const errors: string[] = [];
    let scored = 0;
    for (const job of jobs) {
      try {
        const s = await this.scoreJob(job, cv);
        scored += 1;
        this.log.log(`${s.score.toString().padStart(3)}  ${job.title} @ ${job.company}`);
      } catch (e) {
        errors.push(`score ${job.id}: ${(e as Error).message}`);
        if (isQuotaError(e)) break; // free quota used up: stop, the rest get scored tomorrow
      }
    }
    return { scored, errors };
  }
}
