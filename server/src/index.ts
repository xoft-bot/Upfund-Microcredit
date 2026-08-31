import { buildApp } from './app.js';
import { runReconciliationCycle } from './jobs/reconciliationCron.js';
import { validateRuntimeConfig } from './config.js';

validateRuntimeConfig();
const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: process.env.HOST ?? '0.0.0.0' }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

const schedulerEnabled = process.env.RECONCILIATION_SCHEDULER_ENABLED === 'true';
const schedulerIntervalMs = Number(process.env.RECONCILIATION_SCHEDULER_INTERVAL_MS ?? 300_000);
const schedulerActorUserId = process.env.RECONCILIATION_SCHEDULER_ACTOR_USER_ID;
const schedulerPolicyVersion = process.env.RECONCILIATION_POLICY_VERSION ?? 'v1';
let schedulerTimer: NodeJS.Timeout | undefined;

if (schedulerEnabled && schedulerActorUserId && Number.isInteger(schedulerIntervalMs) && schedulerIntervalMs >= 60_000) {
  const runScheduledReconciliation = async () => {
    try {
      const result = await runReconciliationCycle({ actorUserId: schedulerActorUserId, policyVersion: schedulerPolicyVersion });
      app.log.info({ ...result, policyVersion: schedulerPolicyVersion }, 'reconciliation cycle completed');
    } catch (error) {
      app.log.error({ err: error }, 'reconciliation cycle failed');
    }
  };
  schedulerTimer = setInterval(() => void runScheduledReconciliation(), schedulerIntervalMs);
  schedulerTimer.unref();
  void runScheduledReconciliation();
} else if (schedulerEnabled) {
  app.log.error('reconciliation scheduler requires an actor user id and an interval of at least 60000ms');
}

const shutdown = async () => {
  if (schedulerTimer) clearInterval(schedulerTimer);
  await app.close();
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
