import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import { AiService } from '../ai/ai.service';
import { PipelineModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Quick setup check: npm run ai:check
 * - shows which AI provider and models will be used
 * - lists the Gemini Flash models your key can use
 * - makes one tiny test call
 * - checks the database connection
 */
async function main() {
  const app = await NestFactory.createApplicationContext(PipelineModule, { logger: ['error'] });
  const ai = app.get(AiService);
  let ok = true;

  console.log(`AI provider:   ${ai.provider ?? '(none)'}`);
  if (!ai.isEnabled()) {
    console.log(`  ✗ ${ai.disabledReason()}`);
    ok = false;
  } else {
    console.log(`Score model:   ${ai.modelFor('score')}`);
    console.log(`Tailor model:  ${ai.modelFor('tailor')}`);

    if (ai.provider === 'gemini') {
      try {
        const models = await ai.listGeminiModels();
        console.log(`\nFlash models your key can use:\n  ${models.join('\n  ') || '(none found)'}`);
      } catch (e) {
        console.log(`  ✗ could not list models: ${(e as Error).message}`);
      }
    }

    for (const task of ['score', 'tailor'] as const) {
      try {
        const r = await ai.structured({
          task,
          system: 'You are a test.',
          prompt: 'Reply with ok=true and the word "hello".',
          name: 'test',
          description: 'A test reply.',
          schema: { properties: { ok: { type: 'boolean' }, word: { type: 'string' } }, required: ['ok', 'word'] },
          validator: z.object({ ok: z.boolean(), word: z.string() }),
        });
        const backup = ai.lastModel && ai.lastModel !== ai.modelFor(task) ? `, answered by backup ${ai.lastModel}` : '';
        console.log(`  ✓ ${task} model works (${JSON.stringify(r)}${backup})`);
      } catch (e) {
        ok = false;
        console.log(`  ✗ ${task} model failed: ${(e as Error).message}`);
        console.log(`    Tip: pick a model from the list above and set ${ai.provider!.toUpperCase()}_${task.toUpperCase()}_MODEL`);
      }
    }
  }

  try {
    await app.get(PrismaService).$queryRaw`SELECT 1`;
    console.log('\n  ✓ database connection works');
  } catch (e) {
    ok = false;
    const lines = (e as Error).message.split('\n').map((l) => l.trim()).filter(Boolean);
    const useful = lines.find((l) => /can't reach|authentication|password|does not exist|timed out|ssl|tls|refused|engine/i.test(l)) ?? lines[0];
    console.log(`\n  ✗ database connection failed: ${useful?.slice(0, 200)}`);
    console.log('    Tip: copy the Neon string again with "Connection pooling" OFF, and keep ?sslmode=require at the end.');
  }

  await app.close();
  console.log(ok ? '\nAll good. Run: npm run db:push, then npm run pipeline' : '\nFix the ✗ items above, then run this again.');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
