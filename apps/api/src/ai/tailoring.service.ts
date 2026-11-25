import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Job, Prisma } from '@prisma/client';
import { loadBaseCv } from '../config/profile.loader';
import { Cv } from '../cv/cv.schema';
import { renderCvPdf } from '../cv/pdf.renderer';
import { mergeTailored, TailoredSchema } from '../cv/tailor.merge';
import { PrismaService } from '../prisma/prisma.service';
import { AiService, isQuotaError } from './ai.service';
import { jobForPrompt } from './scoring.service';

/** The job's skills found by scoring: what the CV needs to contain. */
export const jobKeywords = (job: Pick<Job, 'matchedSkills' | 'missingSkills'>) => [...job.matchedSkills, ...job.missingSkills];

const bulletList = { type: 'array', items: { type: 'string' } };

const skillGroups = {
  type: 'array',
  items: { type: 'object', properties: { category: { type: 'string' }, skills: bulletList }, required: ['category', 'skills'] },
};

const TAILOR_JSON_SCHEMA = {
  properties: {
    headline: {
      type: 'string',
      description: "CV headline for this job: the job's exact title, cleaned up (no IDs, locations or 'm/f/d'). Plain text.",
    },
    titleIndex: { type: 'integer', minimum: 0, description: 'Index of the closest headline from the numbered title list (backup).' },
    summary: {
      type: 'string',
      description: "3-4 sentence professional summary for this job, 50-80 words. Opens with the job's title. Packs in the job's most important hard skills and keywords. No 'I', no pronouns, no cliches.",
    },
    skillCategoryOrder: { type: 'array', items: { type: 'string' }, description: 'Existing skill category names, most relevant to the job first.' },
    skillOrder: { ...skillGroups, description: 'For each existing category, its existing skills reordered, most relevant first.' },
    addedSkills: {
      ...skillGroups,
      description:
        "EVERY skill, tool, technology, method, qualification and keyword the job asks for (required AND nice-to-have) that the CV does not list yet, spelled exactly as the job spells it. Put each in the best existing category name, or a new short category like 'Tools' or 'Methods'.",
    },
    experience: {
      type: 'array',
      description: 'One item per experience entry, by its index. Same number of bullets as the original.',
      items: { type: 'object', properties: { index: { type: 'integer' }, bullets: bulletList }, required: ['index', 'bullets'] },
    },
    projectOrder: { type: 'array', items: { type: 'integer' }, description: 'Project indexes, most relevant to the job first.' },
    projects: {
      type: 'array',
      description: 'One item per project, by its index. Same number of bullets as the original.',
      items: { type: 'object', properties: { index: { type: 'integer' }, bullets: bulletList }, required: ['index', 'bullets'] },
    },
    coverLetter: { type: 'string', description: '170-230 word cover letter. Plain, confident, specific to the company and role.' },
    keywordsUsed: { type: 'array', items: { type: 'string' }, description: "The job's keywords now in the CV." },
  },
  required: ['headline', 'titleIndex', 'summary', 'skillCategoryOrder', 'skillOrder', 'addedSkills', 'experience', 'projectOrder', 'projects', 'coverLetter', 'keywordsUsed'],
};

const SYSTEM = `You tailor a CV to one job post so it scores as high as possible in applicant tracking systems (ATS) and reads well to a recruiter.

Goal: every important keyword in the job post appears in the CV, spelled exactly as the job spells it.
1. Read the job post and list every hard skill, tool, technology, framework, method and domain keyword it asks for, required and nice-to-have.
2. Any of those the CV doesn't already list go into addedSkills, with the job's exact spelling (e.g. if the job says "RESTful APIs" and "CI/CD", use those words).
3. Headline: the job's own title, cleaned up.
4. Summary: open with the job's title, then the most important keywords from the post, in natural sentences.
5. Bullets: reword them to use the job's language and keywords, and work the most important job keywords into the bullets where they fit the work described. Start each bullet with a strong past-tense verb. One to two lines each. Keep the same number of bullets per entry.
6. Numbers: keep every number from the original bullet, and never add a number that isn't already in the CV (no new percentages, years of experience, team sizes or counts).
7. Don't change employers, job titles under experience, dates, schools or degrees.
8. Plain text only: no emoji, no arrows, no special symbols, no markdown. Use "-" rather than long dashes.
9. Cover letter: no cliches ("I am writing to express"), no made-up facts about the company; mention 2-3 matching experiences from the CV; end with a simple call to action. Sign with the person's name.`;

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
        (jobKeywords(job).length ? `Keywords already found in this job post: ${jobKeywords(job).join(', ')}.\n\n` : '') +
        'Tailor the CV and write the cover letter.',
      name: 'tailored_cv',
      description: 'The tailored CV parts and cover letter.',
      schema: TAILOR_JSON_SCHEMA,
      validator: TailoredSchema,
      maxTokens: 6000,
    });

    const modelUsed = this.ai.lastModel ?? this.ai.modelFor('tailor');
    const cv = mergeTailored(base, tailored);
    const pdf = await renderCvPdf(cv, { keywords: jobKeywords(job) });

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
