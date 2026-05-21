import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueueService } from '../queue/queue.service.js';
import type { Principal } from '../auth/auth.guard.js';

/**
 * Estimates service. Owns the lifecycle: upload -> enqueue -> (worker processes) -> results.
 * Every read is org-scoped via the principal. Never accepts a client-supplied organizationId.
 */
@Injectable()
export class EstimatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async createFromUpload(
    principal: Principal,
    file: { key: string; originalName: string },
    shopId?: string,
  ): Promise<{ id: string; jobId: string }> {
    const estimate = await this.prisma.estimate.create({
      data: {
        organizationId: principal.organizationId,
        shopId: shopId ?? null,
        uploadedById: principal.userId,
        fileKey: file.key,
        fileName: file.originalName,
        status: 'UPLOADED',
      },
    });

    const jobId = await this.queue.enqueueEstimate({
      estimateId: estimate.id,
      organizationId: principal.organizationId,
      fileKey: file.key,
    });

    return { id: estimate.id, jobId };
  }

  async getById(principal: Principal, id: string) {
    const estimate = await this.prisma.estimate.findFirst({
      where: { id, organizationId: principal.organizationId }, // org scope = tenant isolation
      include: {
        lineItems: true,
        vinRecord: true,
        requirements: { include: { oemReferences: { include: { procedure: true } } } },
        reports: true,
        steps: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!estimate) throw new NotFoundException('Estimate not found');
    return estimate;
  }

  async getRequirements(principal: Principal, id: string) {
    await this.assertOwned(principal, id);
    return this.prisma.calibrationRequirement.findMany({
      where: { estimateId: id },
      include: { oemReferences: { include: { procedure: true } }, rule: true },
      orderBy: { confidenceScore: 'desc' },
    });
  }

  async acknowledge(principal: Principal, id: string, statement: string) {
    await this.assertOwned(principal, id);
    return this.prisma.acknowledgement.create({
      data: { estimateId: id, userId: principal.userId, statement },
    });
  }

  private async assertOwned(principal: Principal, id: string): Promise<void> {
    const found = await this.prisma.estimate.findFirst({
      where: { id, organizationId: principal.organizationId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Estimate not found');
  }
}
