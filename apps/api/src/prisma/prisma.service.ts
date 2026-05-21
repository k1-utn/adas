import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Single Prisma client for the app lifecycle. Connects on boot, disconnects on shutdown.
 * All tenant scoping happens at the repository/guard layer — never trust a client-supplied
 * organizationId; it comes from the authenticated principal.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
