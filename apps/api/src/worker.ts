import 'reflect-metadata';
import { startEstimateWorker } from './estimates/estimate.worker.js';

/**
 * Worker entrypoint. Run as a separate process from the API:
 *   ADAS_ROLE=worker node dist/worker.js
 * Scales horizontally and independently of the HTTP API.
 */
const worker = startEstimateWorker();
// eslint-disable-next-line no-console
console.log('ADAS estimate worker started.');

const shutdown = async (): Promise<void> => {
  await worker.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
