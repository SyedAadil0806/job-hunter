import 'reflect-metadata';
import { appendFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { PipelineModule } from '../app.module';
import { buildDigest, sendTelegram } from './notify';
import { PipelineService, Step } from './pipeline.service';

/**
 * CLI entry used by GitHub Actions every morning:
 *   npm run pipeline                  -> collect + score + tailor
 *   npm run pipeline -- --only=collect,score
 */
async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const steps = (onlyArg ? onlyArg.split('=')[1].split(',') : ['collect', 'score', 'tailor']) as Step[];

  const app = await NestFactory.createApplicationContext(PipelineModule, { logger: ['log', 'warn', 'error'] });
  try {
    const result = await app.get(PipelineService).run(steps);

    // Nice summary on the GitHub Actions run page.
    if (process.env.GITHUB_STEP_SUMMARY) {
      const lines = [
        '## Job hunt run',
        '',
        `| Collected | New | Filtered out | Scored | CVs tailored |`,
        `|---|---|---|---|---|`,
        `| ${result.collected} | ${result.newJobs} | ${result.filtered} | ${result.scored} | ${result.tailored} |`,
        '',
        '### Ready to apply',
        ...(result.ready.length
          ? result.ready.map((j) => `- **${j.score}** — [${j.title} @ ${j.company}](${j.url}) (${j.location})`)
          : ['Nothing new today.']),
        ...(result.errors.length ? ['', '### Warnings', ...result.errors.map((e) => `- ${e}`)] : []),
      ];
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
    }

    await sendTelegram(
      buildDigest({
        newJobs: result.newJobs,
        newlyReady: result.newlyReady,
        errors: result.errors,
        tailorRan: steps.includes('tailor'),
        dashboardUrl: process.env.DASHBOARD_URL,
      }),
    );
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
