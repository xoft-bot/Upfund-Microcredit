import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CollectorRouteView, computeQueueSyncStatus } from '../client/src/components/field/CollectorRouteView.js';
import { CollectorReportingDashboard } from '../client/src/components/portals/CollectorReportingDashboard.js';
import type { QueueMetrics } from '../client/src/types/field-ops.js';
import type { OfflineQueue } from '../client/src/services/offlineQueue.js';
import type { AuthIdentity } from '../client/src/services/firebase.js';

const mockQueue = {
  retry: vi.fn(async () => {}),
  open: vi.fn(async () => {}),
  start: vi.fn(async () => {}),
  stop: vi.fn(() => {}),
  subscribe: vi.fn(() => () => {}),
  getSnapshot: vi.fn(async () => ({ records: [], batches: [], metrics: { queued: 0, syncing: 0, rejected: 0, conflict: 0, stale: 0 } })),
} as unknown as OfflineQueue;

const sampleIdentity: AuthIdentity = {
  uid: 'collector-user-1',
  userId: 'collector-1',
  collectorId: 'collector-1',
  role: 'collector',
  branchId: 'branch-1',
  clientId: null,
  permissions: ['collections:record'],
};

describe('computeQueueSyncStatus logic', () => {
  it('returns attention state when an error or rejected/conflict items exist', () => {
    const statusWithError = computeQueueSyncStatus({
      online: true,
      isSyncing: false,
      metrics: { queued: 0, syncing: 0, rejected: 0, conflict: 0, stale: 0 },
      queueReady: true,
      queueError: 'IndexedDB quota exceeded',
    });
    expect(statusWithError.status).toBe('attention');
    expect(statusWithError.badgeClass).toBe('is-critical');
    expect(statusWithError.badgeText).toBe('Attention required');
    expect(statusWithError.summary).toContain('IndexedDB quota exceeded');

    const statusWithRejections = computeQueueSyncStatus({
      online: true,
      isSyncing: false,
      metrics: { queued: 1, syncing: 0, rejected: 1, conflict: 0, stale: 0 },
      queueReady: true,
    });
    expect(statusWithRejections.status).toBe('attention');
    expect(statusWithRejections.badgeClass).toBe('is-critical');
    expect(statusWithRejections.badgeText).toBe('Attention required');
  });

  it('returns syncing state when syncing flag or syncing count is active', () => {
    const status = computeQueueSyncStatus({
      online: true,
      isSyncing: true,
      metrics: { queued: 2, syncing: 1, rejected: 0, conflict: 0, stale: 0 },
      queueReady: true,
    });
    expect(status.status).toBe('syncing');
    expect(status.badgeClass).toBe('is-info');
    expect(status.badgeText).toBe('Syncing…');
    expect(status.summary).toContain('Uploading');
  });

  it('returns offline state when device is not connected', () => {
    const status = computeQueueSyncStatus({
      online: false,
      isSyncing: false,
      metrics: { queued: 3, syncing: 0, rejected: 0, conflict: 0, stale: 0 },
      queueReady: true,
    });
    expect(status.status).toBe('offline');
    expect(status.badgeClass).toBe('is-warning');
    expect(status.badgeText).toBe('Offline Mode');
    expect(status.summary).toContain('3 payments stored securely on device');
  });

  it('returns pending state when queued payments are waiting to sync online', () => {
    const status = computeQueueSyncStatus({
      online: true,
      isSyncing: false,
      metrics: { queued: 4, syncing: 0, rejected: 0, conflict: 0, stale: 0 },
      queueReady: true,
    });
    expect(status.status).toBe('pending');
    expect(status.badgeClass).toBe('is-warning');
    expect(status.badgeText).toBe('Pending Sync');
    expect(status.title).toBe('4 Payments Queued');
  });

  it('returns synced state when all queued items have posted and verified', () => {
    const status = computeQueueSyncStatus({
      online: true,
      isSyncing: false,
      metrics: { queued: 0, syncing: 0, rejected: 0, conflict: 0, stale: 0 },
      queueReady: true,
    });
    expect(status.status).toBe('synced');
    expect(status.badgeClass).toBe('is-positive');
    expect(status.badgeText).toBe('All Synced');
    expect(status.title).toBe('Offline Queue Synchronized');
  });
});

describe('CollectorRouteView queue sync indicator', () => {
  const onCollect = vi.fn();

  it('renders visual status indicator card and compact badge in synced state', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <CollectorRouteView
          queue={mockQueue}
          routeName="Kampala Central Route"
          records={[]}
          metrics={{ queued: 0, syncing: 0, rejected: 0, conflict: 0, stale: 0 }}
          queueReady={true}
          onCollect={onCollect}
        />
      </MemoryRouter>
    );

    expect(markup).toContain('data-testid="queue-sync-status-indicator"');
    expect(markup).toContain('data-testid="compact-sync-badge"');
    expect(markup).toContain('status-synced');
    expect(markup).toContain('All Synced');
    expect(markup).toContain('Offline Queue Synchronized');
    expect(markup).toContain('data-testid="button-sync-now"');
    expect(markup).toContain('data-testid="link-inspect-offline-queue"');
    expect(markup).toContain('<strong>0</strong> queued');
  });

  it('renders pending sync indicator with queued count', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <CollectorRouteView
          queue={mockQueue}
          routeName="Kampala Central Route"
          records={[]}
          metrics={{ queued: 5, syncing: 0, rejected: 0, conflict: 0, stale: 0 }}
          queueReady={true}
          onCollect={onCollect}
        />
      </MemoryRouter>
    );

    expect(markup).toContain('status-pending');
    expect(markup).toContain('Pending Sync');
    expect(markup).toContain('5 Payments Queued');
    expect(markup).toContain('<strong>5</strong> queued');
  });

  it('renders critical attention badge when there are conflicts or rejections', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <CollectorRouteView
          queue={mockQueue}
          routeName="Kampala Central Route"
          records={[]}
          metrics={{ queued: 1, syncing: 0, rejected: 1, conflict: 1, stale: 0 }}
          queueReady={true}
          onCollect={onCollect}
        />
      </MemoryRouter>
    );

    expect(markup).toContain('status-attention');
    expect(markup).toContain('Attention required');
    expect(markup).toContain('Sync Attention Required');
    expect(markup).toContain('<strong>1</strong> conflicts');
    expect(markup).toContain('<strong>1</strong> rejected');
  });
});

describe('CollectorReportingDashboard queue sync indicator', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: {
        filters: { asOf: '2026-09-28', from: '2026-09-28', to: '2026-09-28', branchId: 'branch-1', collectorId: 'collector-1' },
        targetProgress: { targetAmount: 500000, actualAmount: 350000, pendingAmount: 50000, progressPercent: 70, scheduledClientCount: 10, overdueClientCount: 1 },
        routes: [],
        assignedClientSchedules: [],
        overdueWatchlist: [],
        paymentMethods: [],
        offlineQueue: [],
      },
    }), { status: 200 })));
  });

  it('renders visual status indicator on collector dashboard', () => {
    const metrics: QueueMetrics = { queued: 2, syncing: 0, rejected: 0, conflict: 0, stale: 0 };
    const initialSnapshot = {
      filters: { asOf: '2026-09-28', from: '2026-09-28', to: '2026-09-28', branchId: 'branch-1', collectorId: 'collector-1' },
      targetProgress: { targetAmount: 500000, actualAmount: 350000, pendingAmount: 50000, progressPercent: 70, scheduledClientCount: 10, overdueClientCount: 1 },
      routes: [],
      assignedClientSchedules: [],
      overdueWatchlist: [],
      paymentMethods: [],
      offlineQueue: [],
    };
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <CollectorReportingDashboard
          identity={sampleIdentity}
          metrics={metrics}
          queueReady={true}
          initialSnapshot={initialSnapshot}
        />
      </MemoryRouter>
    );

    expect(markup).toContain('data-testid="collector-dashboard-sync-badge"');
    expect(markup).toContain('data-testid="collector-offline-queue-card"');
    expect(markup).toContain('data-testid="collector-reporting-sync-indicator"');
    expect(markup).toContain('Pending Sync');
    expect(markup).toContain('<strong>2</strong> queued');
  });
});
