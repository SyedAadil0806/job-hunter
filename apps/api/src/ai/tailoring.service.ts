import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Job, Prisma } from '@prisma/client';
import { loadBaseCv } from '../config/profile.loader';
import { Cv } from '../cv/cv.schema';
import { renderCvPdf } from '../cv/pdf.renderer';
import { mergeTailored, TailoredSchema } from '../cv/tailor.merge';
import { PrismaService } from '../prisma/prisma.service';
import { AiService, isQuotaError } from './ai.service';
import { jobForPrompt } from './scoring.service';

const bulletList = { type: 'array', items: { type: 'string' } };

const TAILOR_JSON_SCHEMA = {
  properties: {
    titleIndex: { type: 'integer', minimum: 0, description: 'Index of the best headline from the numbered title list.' },
    summary: { type: 'string', description: '2-3 sentence professional summary aimed at this job. First person implied, no "I".' },
    skillCategoryOrder: { type: 'array', items: { type: 'string' }, description: 'Existing skill category names, most relevant first.' },
    skillOrder: {
      type: 'array',
      description: 'For each existing category, its EXISTING skills reordered most relevant first. Do not add skills.',
      items: { type: 'object', properties: { category: { type: 'string' }, skills: bulletList }, required: ['category', 'skills'] },
    },
    experience: {
      type: 'array',
      description: 'One item per experience entry, by its index. Same number of bullets as the original.',
      items: { type: 'object', properties: { index: { type: 'integer' }, bullets: bulletList }, required: ['index', 'bullets'] },
    },
    projectOrder: { type: 'array', items: { type: 'integer' }, description: 'Project indexes, most relevant first.' },
    projects: {
      type: 'array',
      description: 'One item per project, by its index. Same number of bullets as the original.',
      items: { type: 'object', properties: { index: { type: 'integer' }, bullets: bulletList }, required: ['index', 'bullets'] },
    },
    coverLetter: { type: 'string', description: '170-230 word cover letter. Plain, confident, specific to the company and role.' },
    keywordsUsed: { type: 'array', items: { type: 'string' }, description: 'Job keywords you worked into the CV.' },
  },
  required: ['titleIndex', 'summary', 'skillCategoryOrder', 'skillOrder', 'experience', 'projectOrder', 'projects', 'coverLetter', 'keywordsUsed'],
};

const SYSTEM = `You tailor a real person's CV to one job post. Hard rules:
1. NEVER invent anything: no new skills, tools, employers, titles, dates, numbers, results, or responsibilities.
2. You may: reword bullets to use the job's language for things the person ALREADY did, reorder skills and projects, and rewrite the summary.
3. Keep every number exactly as written in the original. Do not add new numbers.
4. Keep the same number of bullets for each entry. Each bullet: one line-ish, starts with a strong verb, no fluff.
5. Use keywords from the job post only where they truthfully describe the person's real experience (this helps ATS).
6. Cover letter: no clichés ("I am writing to express"), no made-up facts about the company; mention 2-3 real matching experiences; end with a simple call to action. Sign with the person's name.`;

@Injectable()
export class TailoringService {
  private readonly log = new Logger(TailoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async tailorJob(jobOrId: Job | string, base: Cv = loadBaseCv()) {
    const job =
      typeof jobOrId === 'string' ? await this.prisma.job.findUnique({ where: { id: jobOrId } }) : jobOrId;
    if (!job) throw new NotFoundException('Job not found');

    const titles = [base.title, ...base.titleOptions];
    const { title: _title, titleOptions: _opts, ...rest } = base;
    const indexedCv = {
      titles: titles.map((title, index) => ({ index, title })),
      ...rest,
      experience: base.experience.map((e, index) => ({ index, ...e })),
      projects: base.projects.map((p, index) => ({ index, ...p })),
    };

    const tailored = await this.ai.structured({
      task: 'tailor',
      system: SYSTEM,
      prompt:
        `<cv>\n${JSON.stringify(indexedCv, null, 2)}\n</cv>\n\n<job>\n${jobForPrompt(job, 9000)}\n</job>\n\n` +
        (job.missingSkills.length
          ? `The person does NOT have these skills, so do not claim them: ${job.missingSkills.join(', ')}.\n\n`
          : '') +
        'Tailor the CV and write the cover letter.',
      name: 'tailored_cv',
      description: 'The tailored CV parts and cover letter.',
      schema: TAILOR_JSON_SCHEMA,
      validator: TailoredSchema,
      maxTokens: 6000,
    });

    const modelUsed = this.ai.lastModel ?? this.ai.modelFor('tailor');
    const cv = mergeTailored(base, tailored);
    const pdf = await renderCvPdf(cv);

    const version = await this.prisma.$transaction(async (tx) => {
      const v = await tx.cvVersion.create({
        data: {
          jobId: job.id,
          content: cv as unknown as Prisma.InputJsonValue,
          coverLetter: tailored.coverLetter.trim(),
          pdf: new Uint8Array(pdf),
          model: `${this.ai.provider}:${modelUsed}`,
        },
      });
      if (job.status === 'SCORED' || job.status === 'NEW') {
        await tx.job.update({ where: { id: job.id }, data: { status: 'READY' } });
      }
      return v;
    });
    this.log.log(`tailored CV for ${job.title} @ ${job.company}`);
    return version;
  }

  /** Tailor the best scored jobs that don't have a CV yet. */
  async tailorTop(limit: number, minScore: number): Promise<{ tailored: number; errors: string[] }> {
    if (limit <= 0) return { tailored: 0, errors: [] };
    const jobs = await this.prisma.job.findMany({
      where: { status: 'SCORED', score: { gte: minScore }, cvVersions: { none: {} } },
      orderBy: { score: 'desc' },
      take: limit,
    });
    const base = loadBaseCv();
    const errors: string[] = [];
    let tailored = 0;
    for (const job of jobs) {
      try {
        await this.tailorJob(job, base);
        tailored += 1;
      } catch (e) {
        errors.push(`tailor ${job.id}: ${(e as Error).message}`);
        if (isQuotaError(e)) break;
      }
    }
    return { tailored, errors };
  }
}
