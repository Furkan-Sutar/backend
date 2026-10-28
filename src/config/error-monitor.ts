import { logger } from './logger.js';

export interface ErrorMonitorContext {
  requestId?: string;
  method?: string;
  route?: string;
}

export interface ErrorMonitor {
  captureException(error: unknown, context: ErrorMonitorContext): void | Promise<void>;
}

// Install a provider during application bootstrap (for example, an APM/SaaS SDK).
// The backend remains usable without a vendor-specific dependency.
let provider: ErrorMonitor | undefined;

export function configureErrorMonitor(monitor: ErrorMonitor): void {
  provider = monitor;
}

export function captureException(error: unknown, context: ErrorMonitorContext): void {
  if (!provider) return;
  try {
    void Promise.resolve(provider.captureException(error, context)).catch((monitorError: unknown) => {
      logger.warn({ err: monitorError }, 'Error monitoring provider failed');
    });
  } catch (monitorError) {
    logger.warn({ err: monitorError }, 'Error monitoring provider failed');
  }
}
