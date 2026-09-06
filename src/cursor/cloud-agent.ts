/**
 * Cursor Cloud Agents API 客户端（通用版）：创建 agent → 轮询 run → 拿 PR URL。
 * 上游：orchestrator（quality-fix）、sch1（issue 任务执行）。
 * 下游：api.cursor.com/v1。
 * 不变量：apiKey 为 SecretLike（resolveSecret 解析）；轮询至终态或超时；错误规范成可读字符串。
 */
import { sleep } from '../async/sleep.js';
import { resolveSecret, type SecretLike } from '../secrets/resolve.js';

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

const TERMINAL = new Set(['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED', 'FAILED']);

/** Poll run 直至终态或超时 */
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
        const resp = await cursorFetch<CursorRunResponse>(
            resolved,
            `/agents/${encodeURIComponent(ref.agentId)}/runs/${encodeURIComponent(ref.runId)}`,
        );
        if (!resp.ok) {
            return {
                status: 'ERROR',
                error: formatCursorApiError(resp.data.error, resp.text.slice(0, 300), resp.status),
            };
        }

        const status = resp.data.status ?? 'UNKNOWN';
        if (TERMINAL.has(status)) {
            const prUrl = resp.data.git?.branches?.find((b) => b.prUrl)?.prUrl;
            return {
                status,
                resultText: resp.data.result,
                prUrl,
                error:
                    status === 'FINISHED'
                        ? undefined
                        : formatCursorApiError(resp.data.error, status),
            };
        }

        if (attempt + 1 < maxAttempts) {
            await sleep(intervalMs);
        }
    }

    return { status: 'TIMEOUT', error: 'poll timeout' };
}
