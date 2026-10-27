/**
 * Org 级 I/O 信封：CloudEvents v1.0 对齐 + Workers-World 扩展（ww*）。
 * 传输无关；HTTP / SSE / Queue / Service Binding 共用此形状。
 */
import { InvalidTraceIdError, parseTraceparent } from '../trace-id.js';

export const WORKER_IO_SPECVERSION = '1.0' as const;

export type WorkerIoCategory =
    | 'workflow'
    | 'step'
    | 'attempt'
    | 'sleep'
    | 'wait'
    | 'rollback'
    | 'lifecycle'
    | 'system';

export interface WorkerIoError {
    code: string;
    message: string;
    details?: unknown;
}

/**
 * CloudEvents v1.0 structured JSON + ww* 扩展。
 * wire 字段名与 CNCF 对齐；业务差异只放在 `data`。
 */
export interface WorkerIoEnvelope<TData = unknown> {
    specversion: typeof WORKER_IO_SPECVERSION;
    id: string;
    source: string;
    type: string;
    /** RFC3339 */
    time: string;
    datacontenttype?: 'application/json';
    data?: TData;

    /** 多路复用流名，如 workers-world.workflow_instance */
    wwstream?: string;
    wwcategory?: WorkerIoCategory;
    /** UI 一行摘要（中文） */
    wwsummary?: string;
    /** SSE 终态：触发客户端 refresh */
    wwterminal?: true;
    wwerror?: WorkerIoError;
    /**
     * CloudEvents distributed-tracing：故事起点的 W3C traceparent。
     * 多跳不变；HTTP 头上的 traceparent 仍可每跳更新。
     */
    traceparent?: string;
    /** 配套 tracestate，如 `ww=desk`。无 PII。 */
    tracestate?: string;
}

export const STREAM_WORKFLOW_INSTANCE = 'workers-world.workflow_instance' as const;

const TRACESTATE_MAX = 512;

function formatStoredTraceparent(raw: string): string {
    const parsed = parseTraceparent(raw);
    return `${parsed.version}-${parsed.traceId}-${parsed.spanId}-${parsed.flags}`;
}

function formatStoredTracestate(raw: string): string {
    const value = raw.trim();
    if (!value || value.length > TRACESTATE_MAX) {
        throw new InvalidTraceIdError('tracestate 非法');
    }
    return value;
}

export type CreateWorkerIoInput<TData = unknown> = {
    id: string;
    source: string;
    type: string;
    time?: string;
    data?: TData;
    wwstream?: string;
    wwcategory?: WorkerIoCategory;
    wwsummary?: string;
    wwterminal?: true;
    wwerror?: WorkerIoError;
    traceparent?: string;
    tracestate?: string;
};

export function createWorkerIoEnvelope<TData = unknown>(
    input: CreateWorkerIoInput<TData>,
): WorkerIoEnvelope<TData> {
    const env: WorkerIoEnvelope<TData> = {
        specversion: WORKER_IO_SPECVERSION,
        id: input.id,
        source: input.source,
        type: input.type,
        time: input.time ?? new Date().toISOString(),
        datacontenttype: 'application/json',
    };
    if (input.data !== undefined) {
        env.data = input.data;
    }
    if (input.wwstream !== undefined) {
        env.wwstream = input.wwstream;
    }
    if (input.wwcategory !== undefined) {
        env.wwcategory = input.wwcategory;
    }
    if (input.wwsummary !== undefined) {
        env.wwsummary = input.wwsummary;
    }
    if (input.wwterminal) {
        env.wwterminal = true;
    }
    if (input.wwerror !== undefined) {
        env.wwerror = input.wwerror;
    }
    if (input.traceparent !== undefined) {
        env.traceparent = formatStoredTraceparent(input.traceparent);
    }
    if (input.tracestate !== undefined) {
        env.tracestate = formatStoredTracestate(input.tracestate);
    }
    return env;
}

/** 终态：显式 wwterminal，或 lifecycle 流控/workflow 终态 type */
export function isWorkerIoTerminal(e: WorkerIoEnvelope): boolean {
    if (e.wwterminal === true) {
        return true;
    }
    return (
        e.type === 'workers-world.io.stream.end' ||
        e.type.endsWith('.workflow.completed') ||
        e.type.endsWith('.workflow.errored') ||
        e.type.endsWith('.workflow.terminated') ||
        e.type === 'workers-world.workflow.completed' ||
        e.type === 'workers-world.workflow.errored' ||
        e.type === 'workers-world.workflow.terminated'
    );
}

export function isWorkerIoEnvelope(raw: unknown): raw is WorkerIoEnvelope {
    if (raw == null || typeof raw !== 'object') {
        return false;
    }
    const o = raw as Record<string, unknown>;
    return (
        o.specversion === WORKER_IO_SPECVERSION &&
        typeof o.id === 'string' &&
        typeof o.source === 'string' &&
        typeof o.type === 'string' &&
        typeof o.time === 'string'
    );
}
