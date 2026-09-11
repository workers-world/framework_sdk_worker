/**
 * Cursor Cloud Agents API 客户端（通用版）：创建 agent → 轮询 run → 拿 PR URL。
 * 上游：orchestrator（quality-fix）、sch1（issue 任务执行）。
 * 下游：api.cursor.com/v1。
 * 不变量：apiKey 为 SecretLike（resolveSecret 解析）；轮询至终态或超时；错误规范成可读字符串。
 */
import { sleep } from '../async/sleep.js';
import { resolveSecret, type SecretLike } from '../secrets/resolve.js';
import { readSseStream } from './sse-parser.js';

const CURSOR_API_BASE = 'https://api.cursor.com/v1';

export interface CursorAgentCreateInput {
    apiKey: SecretLike;
    /** 仓库 https URL */
    repoUrl: string;
    promptText: string;
    /** model id（如 composer-2.5 / auto）；缺省 auto */
    modelId?: string;
    autoCreatePR?: boolean;
    name?: string;
}

export interface CursorAgentRunRef {
    agentId: string;
    runId: string;
}

export interface CursorAgentRunResult {
    status: string;
    resultText?: string;
    prUrl?: string;
    error?: string;
}

interface CursorCreateResponse {
    ok?: boolean;
    agent?: { id?: string };
    run?: { id?: string; status?: string };
    error?: string | { code?: string; message?: string };
    message?: string;
}

interface CursorRunResponse {
    status?: string;
    result?: string;
    error?: string | { code?: string; message?: string };
    git?: {
        branches?: Array<{ prUrl?: string; url?: string }>;
    };
}

/** 将 Cursor API 的 error 字段规范成可读字符串 */
export function formatCursorApiError(
    error: unknown,
    fallback?: string,
    httpStatus?: number,
): string {
    if (typeof error === 'string' && error.trim()) {
        return error.trim();
    }
    if (error && typeof error === 'object') {
        const obj = error as { code?: unknown; message?: unknown };
        const message = typeof obj.message === 'string' ? obj.message.trim() : '';
        const code = typeof obj.code === 'string' ? obj.code.trim() : '';
        if (message && code) {
            return `${code}: ${message}`;
        }
        if (message) {
            return message;
        }
        if (code) {
            return code;
        }
        try {
            const json = JSON.stringify(error);
            if (json && json !== '{}') {
                return json.slice(0, 500);
            }
        } catch {
            /* ignore */
        }
    }
    if (fallback?.trim()) {
        return fallback.trim();
    }
    if (httpStatus != null) {
        return `HTTP ${httpStatus}`;
    }
    return 'Cursor API error';
}

async function cursorFetch<T>(
    apiKey: string,
    path: string,
    init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T; text: string }> {
    const resp = await fetch(`${CURSOR_API_BASE}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${btoa(`${apiKey}:`)}`,
            ...(init?.headers ?? {}),
        },
    });
    const text = await resp.text();
    let data = {} as T;
    if (text) {
        try {
            data = JSON.parse(text) as T;
        } catch {
            data = {} as T;
        }
    }
    return { ok: resp.ok, status: resp.status, data, text };
}

/** 创建 Cloud Agent run（autoCreatePR 默认 true，供提 PR 类任务） */
export async function createCursorAgent(
    input: CursorAgentCreateInput,
): Promise<{ ok: boolean; ref?: CursorAgentRunRef; error?: string; status?: number }> {
    const apiKey = await resolveSecret(input.apiKey);
    if (!apiKey) {
        return { ok: false, error: 'CURSOR_API_KEY not configured' };
    }

    const body = {
        prompt: { text: input.promptText },
        mode: 'agent',
        model: { id: input.modelId?.trim() || 'auto' },
        repos: [{ url: input.repoUrl }],
        autoCreatePR: input.autoCreatePR !== false,
        skipReviewerRequest: true,
        name: input.name ?? `agent-${Date.now()}`,
    };

    const resp = await cursorFetch<CursorCreateResponse>(apiKey, '/agents', {
        method: 'POST',
        body: JSON.stringify(body),
    });

    const bodyFailed = resp.data.ok === false || Boolean(resp.data.error);
    if (!resp.ok || bodyFailed) {
        const err = formatCursorApiError(
            resp.data.error ?? resp.data.message,
            resp.text.slice(0, 500),
            resp.status,
        );
        return { ok: false, error: err, status: resp.status };
    }

    const agentId = resp.data.agent?.id;
    const runId = resp.data.run?.id;
    if (!agentId || !runId) {
        return { ok: false, error: 'Cursor create response missing agent/run id' };
    }
    return { ok: true, ref: { agentId, runId } };
}

export const CURSOR_RUN_TERMINAL_STATUSES = new Set([
    'FINISHED',
    'ERROR',
    'CANCELLED',
    'EXPIRED',
    'FAILED',
]);

const TERMINAL = CURSOR_RUN_TERMINAL_STATUSES;

export type CursorStreamEvent =
    | { type: 'status'; runId?: string; status: string }
    | { type: 'assistant'; text: string }
    | { type: 'thinking'; text: string }
    | {
          type: 'tool_call';
          callId: string;
          name: string;
          status: 'running' | 'completed';
          args?: unknown;
          result?: unknown;
          truncated?: unknown;
      }
    | {
          type: 'result';
          status: string;
          runId?: string;
          text?: string;
          durationMs?: number;
          prUrl?: string;
      }
    | { type: 'error'; code: string; message: string }
    | { type: 'done' };

/** SSE 流已过期（HTTP 410 stream_expired）；调用方应 fallback GET run */
export class CursorStreamExpiredError extends Error {
    constructor(message = 'stream_expired') {
        super(message);
        this.name = 'CursorStreamExpiredError';
    }
}

function parseJsonData(data: string): Record<string, unknown> {
    if (!data.trim()) {
        return {};
    }
    try {
        const parsed = JSON.parse(data) as unknown;
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

function prUrlFromGit(git: unknown): string | undefined {
    if (!git || typeof git !== 'object') {
        return undefined;
    }
    const branches = (git as { branches?: Array<{ prUrl?: string }> }).branches;
    return branches?.find((b) => b.prUrl)?.prUrl;
}

/** 将 SSE 帧映射为 CursorStreamEvent；heartbeat / interaction_update 返回 null */
export function mapCursorSseFrame(frame: {
    id?: string;
    event: string;
    data: string;
}): (CursorStreamEvent & { id?: string }) | null {
    const payload = parseJsonData(frame.data);
    const base = frame.id ? { id: frame.id } : {};
    switch (frame.event) {
        case 'status':
            return {
                ...base,
                type: 'status',
                runId: typeof payload.runId === 'string' ? payload.runId : undefined,
                status: typeof payload.status === 'string' ? payload.status : 'UNKNOWN',
            };
        case 'assistant':
            return {
                ...base,
                type: 'assistant',
                text: typeof payload.text === 'string' ? payload.text : '',
            };
        case 'thinking':
            return {
                ...base,
                type: 'thinking',
                text: typeof payload.text === 'string' ? payload.text : '',
            };
        case 'tool_call':
            return {
                ...base,
                type: 'tool_call',
                callId: String(payload.callId ?? ''),
                name: String(payload.name ?? ''),
                status: payload.status === 'completed' ? 'completed' : 'running',
                args: payload.args,
                result: payload.result,
                truncated: payload.truncated,
            };
        case 'result': {
            const git = payload.git;
            return {
                ...base,
                type: 'result',
                runId: typeof payload.runId === 'string' ? payload.runId : undefined,
                status: typeof payload.status === 'string' ? payload.status : 'UNKNOWN',
                text: typeof payload.text === 'string' ? payload.text : undefined,
                durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
                prUrl: prUrlFromGit(git),
            };
        }
        case 'error':
            return {
                ...base,
                type: 'error',
                code: typeof payload.code === 'string' ? payload.code : 'stream_error',
                message: typeof payload.message === 'string' ? payload.message : frame.data,
            };
        case 'done':
            return { ...base, type: 'done' };
        case 'heartbeat':
        case 'interaction_update':
            return null;
        default:
            return null;
    }
}

/** 消费 Cursor run SSE 直至 `done` 或连接结束；410 抛 CursorStreamExpiredError */
export async function* streamCursorAgentRun(
    apiKey: SecretLike,
    ref: CursorAgentRunRef,
    opts?: { lastEventId?: string },
): AsyncGenerator<CursorStreamEvent & { id?: string }> {
    const resolved = await resolveSecret(apiKey);
    if (!resolved) {
        yield { type: 'error', code: 'config', message: 'CURSOR_API_KEY not configured' };
        return;
    }

    const headers: Record<string, string> = {
        Accept: 'text/event-stream',
        Authorization: `Basic ${btoa(`${resolved}:`)}`,
    };
    if (opts?.lastEventId) {
        headers['Last-Event-ID'] = opts.lastEventId;
    }

    const resp = await fetch(
        `${CURSOR_API_BASE}/agents/${encodeURIComponent(ref.agentId)}/runs/${encodeURIComponent(ref.runId)}/stream`,
        { headers },
    );

    if (resp.status === 410) {
        throw new CursorStreamExpiredError();
    }
    if (!resp.ok) {
        const text = await resp.text();
        let errBody: unknown;
        try {
            errBody = JSON.parse(text) as unknown;
        } catch {
            errBody = text;
        }
        yield {
            type: 'error',
            code: `http_${resp.status}`,
            message: formatCursorApiError(errBody, text.slice(0, 300), resp.status),
        };
        return;
    }
    if (!resp.body) {
        yield { type: 'error', code: 'no_body', message: 'SSE response missing body' };
        return;
    }

    for await (const frame of readSseStream(resp.body)) {
        const mapped = mapCursorSseFrame(frame);
        if (mapped) {
            yield mapped;
            if (mapped.type === 'done') {
                return;
            }
        }
    }
}

/** 单次查询 run 状态（不循环）：供调用方实现 step 化轮询（轮询间可检查取消/暂停标志） */
export async function fetchCursorAgentRun(
    apiKey: SecretLike,
    ref: CursorAgentRunRef,
): Promise<CursorAgentRunResult & { terminal: boolean }> {
    const resolved = await resolveSecret(apiKey);
    if (!resolved) {
        return { status: 'ERROR', terminal: true, error: 'CURSOR_API_KEY not configured' };
    }
    const resp = await cursorFetch<CursorRunResponse>(
        resolved,
        `/agents/${encodeURIComponent(ref.agentId)}/runs/${encodeURIComponent(ref.runId)}`,
    );
    if (!resp.ok) {
        return {
            status: 'ERROR',
            terminal: true,
            error: formatCursorApiError(resp.data.error, resp.text.slice(0, 300), resp.status),
        };
    }
    const status = resp.data.status ?? 'UNKNOWN';
    const prUrl = resp.data.git?.branches?.find((b) => b.prUrl)?.prUrl;
    return {
        status,
        terminal: TERMINAL.has(status),
        resultText: resp.data.result,
        prUrl,
        error: status === 'FINISHED' ? undefined : formatCursorApiError(resp.data.error, status),
    };
}

/** Poll run 直至终态或超时（非 step 环境/简单场景用；Workflows 里建议 fetchCursorAgentRun + step.sleep 循环） */
export async function pollCursorAgentRun(
    apiKey: SecretLike,
    ref: CursorAgentRunRef,
    options?: { maxAttempts?: number; intervalMs?: number },
): Promise<CursorAgentRunResult> {
    const resolved = await resolveSecret(apiKey);
    if (!resolved) {
        return { status: 'ERROR', error: 'CURSOR_API_KEY not configured' };
    }

    const maxAttempts = options?.maxAttempts ?? 40;
    const intervalMs = options?.intervalMs ?? 15_000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const result = await fetchCursorAgentRun(apiKey, ref);
        if (result.terminal) {
            return {
                status: result.status,
                resultText: result.resultText,
                prUrl: result.prUrl,
                error: result.error,
            };
        }

        if (attempt + 1 < maxAttempts) {
            await sleep(intervalMs);
        }
    }

    return { status: 'TIMEOUT', error: 'poll timeout' };
}
