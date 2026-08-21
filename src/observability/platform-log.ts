/**
 * Cloudflare Workers Observability 平台日志类型（REST / Dashboard 导出形态）。
 * 已知字段显式 typing，索引签名容纳平台新增字段，避免下游重复改造。
 */

/** $metadata — Observability 单条 log 的元数据块 */
export interface WorkersPlatformLogMetadata {
    id?: string;
    requestId?: string;
    invocationId?: string;
    trigger?: string;
    service?: string;
    level?: string;
    message?: string;
    account?: string;
    type?: string;
    fingerprint?: string;
    origin?: string;
    messageTemplate?: string;
    timestamp?: string;
    [key: string]: unknown;
}

/** $workers — Worker 运行时与 invocation 摘要 */
export interface WorkersPlatformLogWorkers {
    truncated?: boolean;
    scriptName?: string;
    outcome?: string;
    eventType?: string;
    requestId?: string;
    wallTimeMs?: number;
    cpuTimeMs?: number;
    executionModel?: string;
    scriptVersion?: { id?: string };
    event?: Record<string, unknown>;
    [key: string]: unknown;
}

/** 单条 Observability log event（view=events 数组元素） */
export interface WorkersPlatformLogEvent {
    level?: string;
    message?: string;
    timestamp?: string;
    dataset?: string;
    source?: Record<string, unknown>;
    $workers?: WorkersPlatformLogWorkers;
    $metadata?: WorkersPlatformLogMetadata;
    [key: string]: unknown;
}

export type WorkersObservabilityCaptureRole = 'email' | 'consumer' | 'unknown';

/** 写入 R2 的 capture 文件 envelope */
export interface WorkersObservabilityCaptureBundle {
    schemaVersion: 1;
    invocationId: string;
    role?: WorkersObservabilityCaptureRole;
    dedupKey?: string;
    fetchedAt: string;
    eventCount: number;
    events: WorkersPlatformLogEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 从单条 raw event 解析为平台 log（保留未知字段） */
export function parsePlatformLogEvent(raw: unknown): WorkersPlatformLogEvent | null {
    if (!isRecord(raw)) {
        return null;
    }
    return raw as WorkersPlatformLogEvent;
}

/** 兼容 REST 多种包裹：数组 / { events } / { result } / { result: { events } } */
export function extractPlatformLogEventArray(raw: unknown): unknown[] {
    if (Array.isArray(raw)) {
        return raw;
    }
    if (!isRecord(raw)) {
        return [];
    }
    if (Array.isArray(raw.events)) {
        return raw.events;
    }
    // CF Observability telemetry/query：result.events 为 { events, fields, count, series }
    const eventsContainer = raw.events;
    if (isRecord(eventsContainer) && Array.isArray(eventsContainer.events)) {
        return eventsContainer.events;
    }
    if (Array.isArray(raw.result)) {
        return raw.result;
    }
    const result = raw.result;
    if (isRecord(result) && Array.isArray(result.events)) {
        return result.events;
    }
    return [];
}

/** 防御性解析 REST 响应为平台 log 数组（不裁剪字段） */
export function parsePlatformLogEvents(raw: unknown): WorkersPlatformLogEvent[] {
    return extractPlatformLogEventArray(raw)
        .map(parsePlatformLogEvent)
        .filter((e): e is WorkersPlatformLogEvent => e !== null);
}

/** 从单条 log 提取 invocation / request id（Dashboard 导出多为 requestId） */
export function resolveInvocationIdFromLogEvent(
    event: WorkersPlatformLogEvent,
): string | undefined {
    const meta = event.$metadata;
    const workers = event.$workers;
    const fromMeta =
        typeof meta?.invocationId === 'string'
            ? meta.invocationId
            : typeof meta?.requestId === 'string'
              ? meta.requestId
              : undefined;
    if (fromMeta) {
        return fromMeta;
    }
    if (typeof workers?.requestId === 'string') {
        return workers.requestId;
    }
    return undefined;
}

/** 组装 R2 capture bundle */
export function buildObservabilityCaptureBundle(input: {
    invocationId: string;
    events: WorkersPlatformLogEvent[];
    fetchedAt?: string;
    role?: WorkersObservabilityCaptureRole;
    dedupKey?: string;
}): WorkersObservabilityCaptureBundle {
    return {
        schemaVersion: 1,
        invocationId: input.invocationId,
        role: input.role,
        dedupKey: input.dedupKey,
        fetchedAt: input.fetchedAt ?? new Date().toISOString(),
        eventCount: input.events.length,
        events: input.events,
    };
}

/** R2 对象 key：quality-capture/logs/{invocationId}.json */
export function observabilityCaptureR2Key(invocationId: string): string {
    return `quality-capture/logs/${invocationId}.json`;
}
