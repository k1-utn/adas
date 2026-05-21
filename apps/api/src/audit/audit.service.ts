import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Principal } from '../auth/auth.guard.js';

/**
 * Append-only audit logging. Every mutating action calls this. Rows are never updated or
 * deleted by application code — this is the defensibility/compliance backbone alongside
 * ProcessingStep.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    principal: Principal,
    action: string,
    entity?: { type: string; id: string },
    metadata?: Record<string, unknown>,
    ipAddress?: string,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        organizationId: principal.organizationId,
        userId: principal.userId,
        action,
        entityType: entity?.type,
        entityId: entity?.id,
        metadata: metadata as object,
        ipAddress,
      },
    });
  }
}
