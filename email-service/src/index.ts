import { randomUUID } from 'node:crypto';
import { loadConfig, loadLocalEnv } from './config.ts';
import { CoWatchApiClient } from './apiClient.ts';
import { EmailProviderRegistry } from './providers.ts';
import { createEmailServiceServer } from './server.ts';
import { startEmailWorker } from './worker.ts';

async function main(): Promise<void> {
  loadLocalEnv();
  const config = loadConfig();
  const providers = new EmailProviderRegistry(config);
  const api = new CoWatchApiClient(config);
  let server: ReturnType<typeof createEmailServiceServer>;

  try {
    await providers.validateConfiguredProviders();
    server = createEmailServiceServer(config, providers);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await providers.close();
    throw error;
  }

  const workerStop = startEmailWorker({
    api,
    providers,
    config,
    workerId: 'email-service-' + randomUUID(),
  });
  console.log('[EmailService] Listening on ' + config.host + ':' + config.port);

  let shutdown: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (shutdown) return shutdown;
    shutdown = (async () => {
      console.log('[EmailService] Graceful shutdown started');
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await workerStop();
      await providers.close();
      console.log('[EmailService] Shutdown complete');
    })();
    return shutdown;
  };

  process.once('SIGTERM', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); });
}

main().catch((error: unknown) => {
  console.error('[EmailService] Startup failed:', error instanceof Error ? error.message : 'UNKNOWN_ERROR');
  process.exitCode = 1;
});
