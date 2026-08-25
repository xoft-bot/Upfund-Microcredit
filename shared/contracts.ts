export type UserRole = 'admin' | 'manager' | 'officer' | 'collector' | 'accountant';

export interface Actor {
  userId: string;
  firebaseUid: string;
  role: UserRole;
  branchId: string | null;
}

export interface AuditEventInput {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  correlationId: string;
  metadata?: Record<string, unknown>;
}

export interface HealthResponse {
  ok: true;
  data: { service: string; database: string };
  correlationId: string;
}
