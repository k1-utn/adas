import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

import { PrismaService } from './prisma/prisma.service.js';
import { AuditService } from './audit/audit.service.js';
import { VinService } from './vin/vin.service.js';
import { QueueService } from './queue/queue.service.js';
import { EstimatesService } from './estimates/estimates.service.js';
import { ReportService } from './reports/report.service.js';
import { VinController, EstimatesController } from './estimates/estimates.controller.js';
import { AuthGuard, RolesGuard, type TokenVerifier, type Principal } from './auth/auth.guard.js';

/**
 * Token verifier binding. In production this wraps the Clerk SDK to verify the session JWT
 * and map the Clerk user/org to our Principal. The dev stub trusts a header for local use.
 */
class DevTokenVerifier implements TokenVerifier {
  async verify(token: string): Promise<Principal | null> {
    // DEV ONLY: token is base64(JSON principal). Replace with Clerk verification in prod.
    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
      return decoded as Principal;
    } catch {
      return null;
    }
  }
}

@Module({
  controllers: [VinController, EstimatesController],
  providers: [
    PrismaService,
    AuditService,
    VinService,
    QueueService,
    EstimatesService,
    ReportService,
    RolesGuard,
    { provide: 'TOKEN_VERIFIER', useClass: DevTokenVerifier },
    {
      provide: AuthGuard,
      useFactory: (v: TokenVerifier) => new AuthGuard(v),
      inject: ['TOKEN_VERIFIER'],
    },
  ],
})
export class AppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? '*' });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`ADAS API listening on :${port}/api/v1`);
}

// Only bootstrap when run directly (not when imported by the worker entrypoint).
if (process.env.ADAS_ROLE !== 'worker') {
  bootstrap().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('Bootstrap failed', e);
    process.exit(1);
  });
}
