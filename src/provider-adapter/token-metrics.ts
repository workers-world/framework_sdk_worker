import type { TokenBuckets, UsageSnapshot } from './types.js';

export type TokenMetrics = TokenBuckets & { cost_usd: number };

export function emptyTokenMetrics(): TokenMetrics {
    return {
        tokens_input: 0,
        tokens_output: 0,
        tokens_reasoning: 0,
        tokens_cache_read: 0,
        tokens_cache_write: 0,
        cost_usd: 0,
    };
}

function asFinite(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

function tokensFromRecord(tokens: unknown): Omit<TokenMetrics, 'cost_usd'> | null {
    if (!tokens || typeof tokens !== 'object') {
        return null;
    }
    const t = tokens as Record<string, unknown>;
    const cache =
        t.cache && typeof t.cache === 'object' ? (t.cache as Record<string, unknown>) : undefined;
    return {
        tokens_input: asFinite(t.input),
        tokens_output: asFinite(t.output),
        tokens_reasoning: asFinite(t.reasoning),
        tokens_cache_read: asFinite(cache?.read),
        tokens_cache_write: asFinite(cache?.write),
    };
}

export interface SumTokenMetricsOptions {
    /** OpenCode Harness：user inbox message id 为 `msg_${operationId}` */
    operationId?: string;
    /** user op 消息不在 transcript 时，按 message time.created ≥ sinceMs（如 compaction 后） */
    sinceMs?: number;
}

function messageCreatedMs(msg: Record<string, unknown>): number | null {
    const time = msg.time;
    if (!time || typeof time !== 'object') {
        return null;
    }
    const created = (time as Record<string, unknown>).created;
    if (typeof created === 'number' && Number.isFinite(created)) {
        return created;
    }
    if (typeof created === 'string' && created.trim() !== '') {
        const ms = Date.parse(created);
        return Number.isFinite(ms) ? ms : null;
    }
    return null;
}

function operationMessagePrefix(operationId: string): string {
    return `msg_${operationId.trim()}`;
}

function messageIdMatchesOperationPrefix(id: string, prefix: string): boolean {
    return id === prefix || id.startsWith(`${prefix}_`) || id.startsWith(prefix);
}

/**
 * Mirror OpenCodeHarness `_messagesAfter(msg_${operationId})`: user op row, then
 * following messages until the next `user` or `idle`.
 */
export function messagesForOperation(
    messages: readonly unknown[],
    operationId: string,
): unknown[] | null {
    const prefix = operationMessagePrefix(operationId);
    const start = messages.findIndex((msg) => {
        if (!msg || typeof msg !== 'object') {
            return false;
        }
        const id =
            typeof (msg as Record<string, unknown>).id === 'string'
                ? ((msg as Record<string, unknown>).id as string)
                : '';
        return messageIdMatchesOperationPrefix(id, prefix);
    });
    if (start < 0) {
        return null;
    }

    const out: unknown[] = [messages[start]];
    for (let i = start + 1; i < messages.length; i++) {
        const msg = messages[i];
        if (!msg || typeof msg !== 'object') {
            continue;
        }
        const type =
            typeof (msg as Record<string, unknown>).type === 'string'
                ? ((msg as Record<string, unknown>).type as string)
                : '';
        if (type === 'user' || type === 'idle') {
            break;
        }
        out.push(msg);
    }
    return out;
}

type ScopedMessages =
    | { mode: 'all'; scope: readonly unknown[] }
    | { mode: 'operation_window'; scope: readonly unknown[] }
    | { mode: 'since_ms'; scope: readonly unknown[] }
    | { mode: 'empty'; scope: readonly unknown[] };

function resolveScopedMessages(
    messages: readonly unknown[],
    options: SumTokenMetricsOptions | undefined,
): ScopedMessages {
    if (!options?.operationId?.trim() && options?.sinceMs == null) {
        return { mode: 'all', scope: messages };
    }

    const operationId = options?.operationId?.trim();
    if (operationId) {
        const window = messagesForOperation(messages, operationId);
        if (window != null) {
            return { mode: 'operation_window', scope: window };
        }
        if (options?.sinceMs != null) {
            return { mode: 'since_ms', scope: messages };
        }
        return { mode: 'empty', scope: [] };
    }

    return { mode: 'since_ms', scope: messages };
}

function messageMatchesSinceMs(msg: Record<string, unknown>, sinceMs: number): boolean {
    const created = messageCreatedMs(msg);
    return created != null && created >= sinceMs;
}

function accumulateAssistantMetrics(messages: readonly unknown[], out: TokenMetrics): number {
    let matched = 0;
    for (const msg of messages) {
        if (!msg || typeof msg !== 'object') {
            continue;
        }
        const m = msg as Record<string, unknown>;
        const type = typeof m.type === 'string' ? m.type : '';
        if (type && type !== 'assistant') {
            continue;
        }
        matched += 1;
        const part = tokensFromRecord(m.tokens);
        if (part) {
            out.tokens_input += part.tokens_input;
            out.tokens_output += part.tokens_output;
            out.tokens_reasoning += part.tokens_reasoning;
            out.tokens_cache_read += part.tokens_cache_read;
            out.tokens_cache_write += part.tokens_cache_write;
        }
        out.cost_usd += asFinite(m.cost);
    }
    return matched;
}

/**
 * Sum `tokens` / `cost` from OpenCode transcript messages (assistant turns).
 * With operationId, scope matches harness `_messagesAfter`; no ses_root fallback.
 */
export function sumTokenMetricsFromMessages(
    messages: readonly unknown[],
    options?: SumTokenMetricsOptions,
): TokenMetrics {
    const scoped = resolveScopedMessages(messages, options);
    if (scoped.mode === 'empty') {
        return emptyTokenMetrics();
    }

    const out = emptyTokenMetrics();
    let matched = 0;

    if (scoped.mode === 'operation_window' || scoped.mode === 'all') {
        matched = accumulateAssistantMetrics(scoped.scope, out);
    } else {
        const sinceMs = options?.sinceMs;
        if (sinceMs == null) {
            return emptyTokenMetrics();
        }
        for (const msg of scoped.scope) {
            if (!msg || typeof msg !== 'object') {
                continue;
            }
            const m = msg as Record<string, unknown>;
            if (!messageMatchesSinceMs(m, sinceMs)) {
                continue;
            }
            const type = typeof m.type === 'string' ? m.type : '';
            if (type && type !== 'assistant') {
                continue;
            }
            matched += 1;
            const part = tokensFromRecord(m.tokens);
            if (part) {
                out.tokens_input += part.tokens_input;
                out.tokens_output += part.tokens_output;
                out.tokens_reasoning += part.tokens_reasoning;
                out.tokens_cache_read += part.tokens_cache_read;
                out.tokens_cache_write += part.tokens_cache_write;
            }
            out.cost_usd += asFinite(m.cost);
        }
    }

    const filtering = scoped.mode !== 'all';
    if (filtering && matched === 0) {
        return emptyTokenMetrics();
    }
    return out;
}

export function totalTokens(m: TokenBuckets): number {
    return (
        m.tokens_input +
        m.tokens_output +
        m.tokens_reasoning +
        m.tokens_cache_read +
        m.tokens_cache_write
    );
}

export function usageSnapshotFromMetrics(
    metrics: TokenMetrics,
    correlationId: string,
): UsageSnapshot {
    return {
        tokens_input: metrics.tokens_input,
        tokens_output: metrics.tokens_output,
        tokens_reasoning: metrics.tokens_reasoning,
        tokens_cache_read: metrics.tokens_cache_read,
        tokens_cache_write: metrics.tokens_cache_write,
        message_cost_usd: metrics.cost_usd,
        correlationId,
    };
}

/** 过滤后 messages，供 dump 保本窗口 */
export function filterMessagesForRun(
    messages: readonly unknown[],
    options: SumTokenMetricsOptions,
): unknown[] {
    const scoped = resolveScopedMessages(messages, options);
    if (scoped.mode === 'empty') {
        return [];
    }
    if (scoped.mode === 'operation_window' || scoped.mode === 'all') {
        return [...scoped.scope];
    }

    const sinceMs = options.sinceMs;
    if (sinceMs == null) {
        return [];
    }
    return messages.filter((msg) => {
        if (!msg || typeof msg !== 'object') {
            return false;
        }
        return messageMatchesSinceMs(msg as Record<string, unknown>, sinceMs);
    });
}
