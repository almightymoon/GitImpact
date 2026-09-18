import { randomUUID } from "node:crypto";
import type { ApiErrorBody, ApiErrorCode, AnalysisPhase } from "@gitimpact/shared";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  requestId?: string;
  jobId?: string;
  analysisId?: string;
  repository?: string;
  pullRequestNumber?: number;
  phase?: AnalysisPhase | string;
  durationMs?: number;
  status?: string;
  code?: string;
  [key: string]: unknown;
}

const SENSITIVE = /(token|secret|password|authorization|private[_-]?key|api[_-]?key)/i;

function scrub(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (SENSITIVE.test(value) && value.length > 12) return "[redacted]";
    return value;
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) ? "[redacted]" : scrub(v);
    }
    return out;
  }
  return value;
}

export function createRequestId(existing?: string | null): string {
  if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
  return `req_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function log(level: LogLevel, message: string, fields: LogFields = {}): void {
  const entry = scrub({
    level,
    msg: message,
    ts: new Date().toISOString(),
    ...fields,
  });
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  opts: {
    detail?: string;
    retryable?: boolean;
    requestId?: string;
    retryAfterSeconds?: number;
    phase?: AnalysisPhase;
    action?: ApiErrorBody["action"];
  } = {},
): ApiErrorBody {
  return {
    code,
    message,
    detail: opts.detail,
    retryable: opts.retryable ?? false,
    requestId: opts.requestId,
    retryAfterSeconds: opts.retryAfterSeconds,
    phase: opts.phase,
    action: opts.action,
  };
}

type CounterMap = Map<string, number>;
type HistogramMap = Map<string, number[]>;

const counters: CounterMap = new Map();
const histograms: HistogramMap = new Map();

export function incMetric(name: string, by = 1, labels: Record<string, string> = {}): void {
  const key = `${name}|${Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
  counters.set(key, (counters.get(key) ?? 0) + by);
}

export function observeMetric(name: string, valueMs: number, labels: Record<string, string> = {}): void {
  const key = `${name}|${Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
  const arr = histograms.get(key) ?? [];
  arr.push(valueMs);
  if (arr.length > 500) arr.shift();
  histograms.set(key, arr);
}

export function getMetricsSnapshot(): {
  counters: Record<string, number>;
  histograms: Record<string, { count: number; avg: number; p95: number }>;
} {
  const counterOut: Record<string, number> = {};
  for (const [k, v] of counters) counterOut[k] = v;
  const histOut: Record<string, { count: number; avg: number; p95: number }> = {};
  for (const [k, arr] of histograms) {
    const sorted = [...arr].sort((a, b) => a - b);
    const avg = sorted.reduce((s, n) => s + n, 0) / (sorted.length || 1);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
    histOut[k] = { count: sorted.length, avg: Math.round(avg), p95 };
  }
  return { counters: counterOut, histograms: histOut };
}

export function resetMetricsForTests(): void {
  counters.clear();
  histograms.clear();
}
