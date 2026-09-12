import { SYSTEM_VERSION } from '../../../shared/version.js';

export interface TelemetryEvent {
  event: string;
  correlationId: string;
  version: typeof SYSTEM_VERSION;
  route: string;
  occurredAt: string;
  syncLatencyMs?: number;
  metadata: Record<string, unknown>;
}

export type TelemetrySink = (event: TelemetryEvent) => void;
const sensitiveKeys = /token|password|secret|national.?id|borrower.?id|client.?id|loan.?id|phone|mobile|name|email|authorization|cookie/i;
const makeId = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function mask(value: unknown, key = ''): unknown {
  if (sensitiveKeys.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => mask(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, mask(entryValue, entryKey)]));
  return typeof value === 'string' && value.length > 512 ? `${value.slice(0, 512)}…` : value;
}

export class TelemetryHub {
  private readonly sink: TelemetrySink;
  constructor(sink: TelemetrySink = (event) => { if (typeof console !== 'undefined') console.info('[pwa-telemetry]', event); }) { this.sink = sink; }
  capture(event: string, metadata: Record<string, unknown> = {}, options: { correlationId?: string; route?: string; syncLatencyMs?: number } = {}): TelemetryEvent {
    const payload: TelemetryEvent = { event, correlationId: options.correlationId ?? makeId(), version: SYSTEM_VERSION, route: options.route ?? (typeof window === 'undefined' ? 'unknown' : window.location?.pathname ?? 'unknown'), occurredAt: new Date().toISOString(), syncLatencyMs: options.syncLatencyMs, metadata: mask(metadata) as Record<string, unknown> };
    this.sink(payload);
    return payload;
  }
}

export const telemetry = new TelemetryHub();
