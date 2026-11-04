import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Connects on the first query (Prisma does this by itself), not at startup.
 * So the app still starts if Neon's free database is asleep or the URL is wrong,
 * and the error appears where it can be explained (see `npm run ai:check`).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
