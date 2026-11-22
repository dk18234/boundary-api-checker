import { parentPort, workerData } from 'node:worker_threads';
import { compare } from './core/compare.js';
try {
  parentPort?.postMessage({
    report: compare(workerData.baseline, workerData.candidate, workerData.fixtures ?? []),
  });
} catch (e) {
  parentPort?.postMessage({ error: e instanceof Error ? e.message : 'Invalid comparison input' });
}
