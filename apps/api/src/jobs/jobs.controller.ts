import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { jobKeywords, TailoringService } from '../ai/tailoring.service';
import { keywordCoverage } from '../cv/ats';
import { CvSchema } from '../cv/cv.schema';
import { renderCvDocx } from '../cv/docx.renderer';
import { renderCvPdf } from '../cv/pdf.renderer';
import { Public } from '../auth/token.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SOURCE_LABELS } from '../sources';
import { ApplyDto, ListJobsQuery, UpdateApplicationDto } from './jobs.dto';

/** Everything except the big description, for list views. */
const listSelect = {
  id: true,
  source: true,
  title: true,
  company: true,
  location: true,
  isRemote: true,
  url: true,
  salary: true,
  postedAt: true,
  status: true,
  score: true,
  scoreReason: true,
  matchedSkills: true,
  missingSkills: true,
  redFlags: true,
  createdAt: true,
  application: { select: { id: true, status: true, appliedAt: true } },
  _count: { select: { cvVersions: true } },
} satisfies Prisma.JobSelect;

const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'job';

@Controller()
export class JobsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tailoring: TailoringService,
  ) {}

  @Public()
  @Get('health')
  health() {
    return { ok: true };
  }

  @Get('sources')
  sources() {
    return SOURCE_LABELS;
  }

  @Get('stats')
  async stats() {
    const [byStatus, byApp, lastRun] = await Promise.all([
      this.prisma.job.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.application.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.pipelineRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    ]);
    return {
      jobs: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      applications: Object.fromEntries(byApp.map((r) => [r.status, r._count._all])),
      lastRun,
    };
  }

  @Get('jobs')
  async list(@Query() q: ListJobsQuery) {
    const where: Prisma.JobWhereInput = {
      status: q.status ?? { in: ['SCORED', 'READY'] },
      ...(q.minScore !== undefined ? { score: { gte: q.minScore } } : {}),
      ...(q.q
        ? {
            OR: [
              { title: { contains: q.q, mode: 'insensitive' } },
              { company: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        select: listSelect,
        orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: q.take ?? 50,
        skip: q.skip ?? 0,
      }),
      this.prisma.job.count({ where }),
    ]);
    return { items, total };
  }

  @Get('jobs/:id')
  async get(@Param('id') id: string) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        application: true,
        cvVersions: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, content: true, coverLetter: true, model: true, createdAt: true },
        },
      },
    });
    if (!job) throw new NotFoundException('Job not found');
    const latest = job.cvVersions[0];
    const parsed = latest ? CvSchema.safeParse(latest.content) : undefined;
    const ats = parsed?.success ? keywordCoverage(parsed.data, jobKeywords(job)) : null;
    return { ...job, ats };
  }

  /** Make (or remake) a tailored CV for this job right now. */
  @Post('jobs/:id/tailor')
  async tailor(@Param('id') id: string) {
    const v = await this.tailoring.tailorJob(id);
    return { id: v.id, createdAt: v.createdAt };
  }

  @Get('jobs/:id/cv.pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    await this.sendCv(id, 'pdf', res);
  }

  @Get('jobs/:id/cv.docx')
  async docx(@Param('id') id: string, @Res() res: Response) {
    await this.sendCv(id, 'docx', res);
  }

  /**
   * Rendered fresh from the stored CV data each time, so layout fixes reach CVs
   * made before them. Falls back to the stored PDF if old data no longer parses.
   */
  private async sendCv(id: string, format: 'pdf' | 'docx', res: Response) {
    const v = await this.prisma.cvVersion.findFirst({
      where: { jobId: id },
      orderBy: { createdAt: 'desc' },
      include: { job: { select: { company: true, matchedSkills: true, missingSkills: true } } },
    });
    if (!v) throw new NotFoundException('No tailored CV for this job yet');
    const parsed = CvSchema.safeParse(v.content);
    const keywords = jobKeywords(v.job);
    let file: Buffer;
    if (parsed.success) file = format === 'pdf' ? await renderCvPdf(parsed.data, { keywords }) : await renderCvDocx(parsed.data, { keywords });
    else if (format === 'pdf') file = Buffer.from(v.pdf);
    else throw new NotFoundException('This CV is too old for Word. Remake it first.');
    const name = parsed.success ? parsed.data.name : ((v.content as { name?: string }).name ?? 'CV');
    res.setHeader(
      'Content-Type',
      format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(name)} - ${safeName(v.job.company)} - CV.${format}"`);
    res.send(file);
  }

  @Post('jobs/:id/skip')
  async skip(@Param('id') id: string) {
    return this.prisma.job.update({ where: { id }, data: { status: 'SKIPPED' }, select: { id: true, status: true } });
  }

  @Post('jobs/:id/unskip')
  async unskip(@Param('id') id: string) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: { _count: { select: { cvVersions: true } } } });
    if (!job) throw new NotFoundException('Job not found');
    return this.prisma.job.update({
      where: { id },
      data: { status: job._count.cvVersions ? 'READY' : job.score !== null ? 'SCORED' : 'NEW' },
      select: { id: true, status: true },
    });
  }

  /** You clicked "I applied". Links the CV version you used. */
  @Post('jobs/:id/apply')
  async apply(@Param('id') id: string, @Body() body: ApplyDto) {
    const latest = await this.prisma.cvVersion.findFirst({ where: { jobId: id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    return this.prisma.$transaction(async (tx) => {
      const app = await tx.application.upsert({
        where: { jobId: id },
        create: { jobId: id, cvVersionId: latest?.id, notes: body.notes },
        update: { notes: body.notes ?? undefined },
      });
      await tx.job.update({ where: { id }, data: { status: 'APPLIED' } });
      return app;
    });
  }

  @Get('applications')
  async applications() {
    return this.prisma.application.findMany({
      orderBy: { appliedAt: 'desc' },
      include: {
        job: { select: { id: true, title: true, company: true, location: true, isRemote: true, url: true, source: true, score: true } },
      },
    });
  }

  @Patch('applications/:id')
  async updateApplication(@Param('id') id: string, @Body() body: UpdateApplicationDto) {
    return this.prisma.application.update({ where: { id }, data: body });
  }

  /** Undo "I applied". */
  @Delete('applications/:id')
  async removeApplication(@Param('id') id: string) {
    const app = await this.prisma.application.delete({ where: { id } });
    await this.unskip(app.jobId);
    return { ok: true };
  }
}
