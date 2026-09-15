import { buildApp } from './app.js';
import { runReconciliationCycle } from './jobs/reconciliationCron.js';
import { runOverdueDetectionCycle } from './jobs/overdueDetectionCron.js';
import { getServerPort, validateRuntimeConfig } from './config.js';
import { pool } from './db.js';

validateRuntimeConfig();
const app = buildApp();
const port = getServerPort();

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

const overdueSchedulerEnabled = process.env.OVERDUE_SCHEDULER_ENABLED === 'true';
const overdueSchedulerIntervalMs = Number(process.env.OVERDUE_SCHEDULER_INTERVAL_MS ?? 3_600_000);
const overdueSchedulerActorUserId = process.env.OVERDUE_SCHEDULER_ACTOR_USER_ID;
let overdueSchedulerTimer: NodeJS.Timeout | undefined;

if (overdueSchedulerEnabled && overdueSchedulerActorUserId && Number.isInteger(overdueSchedulerIntervalMs) && overdueSchedulerIntervalMs >= 60_000) {
  const runScheduledOverdueDetection = async () => {
    try {
      const result = await runOverdueDetectionCycle({ actorUserId: overdueSchedulerActorUserId });
      app.log.info({ ...result }, 'overdue detection cycle completed');
    } catch (error) {
      app.log.error({ err: error }, 'overdue detection cycle failed');
    }
  };
  overdueSchedulerTimer = setInterval(() => void runScheduledOverdueDetection(), overdueSchedulerIntervalMs);
  overdueSchedulerTimer.unref();
  void runScheduledOverdueDetection();
} else if (overdueSchedulerEnabled) {
  app.log.error('overdue detection scheduler requires an actor user id and an interval of at least 60000ms');
}

const shutdown = async () => {
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (overdueSchedulerTimer) clearInterval(overdueSchedulerTimer);
  await Promise.all([app.close(), pool.end()]);
};
const handleShutdown = () => {
  void shutdown().catch((error) => {
    app.log.error({ err: error }, 'graceful shutdown failed');
    process.exitCode = 1;
  });
};
process.once('SIGTERM', handleShutdown);
process.once('SIGINT', handleShutdown);