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
    /** OpenCode Harness：message id 前缀 `msg_${operationId}` */
    operationId?: string;
    /** 无 id/metadata 命中时，按 message time.created ≥ sinceMs */
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

function messageMatchesFilter(
    msg: Record<string, unknown>,
    options: SumTokenMetricsOptions | undefined,
): boolean {
    if (!options?.operationId && options?.sinceMs == null) {
        return true;
    }

    const operationId = options.operationId?.trim();
    if (operationId) {
        const id = typeof msg.id === 'string' ? msg.id : '';
        // OpenCode Harness：submit(operationId) → message id 前缀 msg_${operationId}
        const prefix = `msg_${operationId}`;
        if (id === prefix || id.startsWith(`${prefix}_`) || id.startsWith(prefix)) {
            return true;
        }

        const meta = msg.metadata;
        if (meta && typeof meta === 'object') {
            const metaOp = (meta as Record<string, unknown>).operationId;
            if (typeof metaOp === 'string' && metaOp === operationId) {
                return true;
            }
        }
    }

    if (options.sinceMs != null) {
        const created = messageCreatedMs(msg);
        if (created != null && created >= options.sinceMs) {
            return true;
        }
    }

    // 有过滤条件但未命中 → 不回退整棵 ses_root
    return false;
}

/**
 * Sum `tokens` / `cost` from OpenCode transcript messages (assistant turns).
 * 传入 operationId/sinceMs 时按本 run 过滤；无命中不回退整棵 ses_root。
 */
export function sumTokenMetricsFromMessages(
    messages: readonly unknown[],
    options?: SumTokenMetricsOptions,
): TokenMetrics {
    const out = emptyTokenMetrics();
    const filtering = Boolean(options?.operationId || options?.sinceMs != null);
    let matched = 0;

    for (const msg of messages) {
        if (!msg || typeof msg !== 'object') {
            continue;
        }
        const m = msg as Record<string, unknown>;
        if (filtering && !messageMatchesFilter(m, options)) {
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
    if (!options.operationId && options.sinceMs == null) {
        return [...messages];
    }
    return messages.filter((msg) => {
        if (!msg || typeof msg !== 'object') {
            return false;
        }
        return messageMatchesFilter(msg as Record<string, unknown>, options);
    });
}
