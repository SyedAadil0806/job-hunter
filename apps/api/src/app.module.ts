import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AiService } from './ai/ai.service';
import { ScoringService } from './ai/scoring.service';
import { TailoringService } from './ai/tailoring.service';
import { TokenGuard } from './auth/token.guard';
import { CollectorService } from './jobs/collector.service';
import { JobsController } from './jobs/jobs.controller';
import { LivenessService } from './jobs/liveness.service';
import { PipelineService } from './pipeline/pipeline.service';
import { PrismaModule } from './prisma/prisma.service';

// apps/api/.env first, then a repo-level .env if you keep one there.
const envFiles = ['.env', '../../.env'];

/** Services shared by the API server and the daily pipeline. */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: envFiles }), PrismaModule],
  providers: [AiService, ScoringService, TailoringService, CollectorService, LivenessService, PipelineService],
  exports: [AiService, ScoringService, TailoringService, CollectorService, LivenessService, PipelineService],
})
export class PipelineModule {}

/** The HTTP API used by the dashboard. */
@Module({
  imports: [PipelineModule],
  controllers: [JobsController],
  providers: [{ provide: APP_GUARD, useClass: TokenGuard }],
})
export class AppModule {}
