import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

/**
 * Job queue (BullMQ over Redis). Estimate processing is slow and rate-limited (OCR + LLM),
 * so the API enqueues a job and returns immediately; a worker process drains the queue and
 * writes ProcessingStep rows as it goes. The WS gateway streams progress to the client.
 */

export const ESTIMATE_QUEUE = 'estimate-processing';

export interface EstimateJobData {
  estimateId: string;
  organizationId: string;
  fileKey: string;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly queue: Queue<EstimateJobData>;

  constructor() {
    const connection = {
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
    };
    this.queue = new Queue<EstimateJobData>(ESTIMATE_QUEUE, { connection });
  }

  async enqueueEstimate(data: EstimateJobData): Promise<string> {
    const job = await this.queue.add('process', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
    this.logger.log(`Enqueued estimate ${data.estimateId} as job ${job.id}`);
    return job.id ?? '';
  }
}
