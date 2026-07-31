/**
 * decision-desk 标的（underlying）统一解析与 trace 发号。
 */
import {isFundCode} from '../fund/normalize-code.js';

const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]+)?$/;

/** 规范化标的键：trim；纯字母 ticker 大写；6 位数字保持原样。 */
export function normalizeUnderlyingKey(raw: string): string {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return '';
    if (isFundCode(trimmed)) return trimmed;
    if (/^[A-Za-z][A-Za-z0-9.]*$/.test(trimmed)) return trimmed.toUpperCase();
    return trimmed;
}

function pickFromTags(tags: string[] | undefined): string | null {
    if (!tags?.length) return null;
    for (const tag of tags) {
        const normalized = normalizeUnderlyingKey(tag);
        if (!normalized) continue;
        if (isFundCode(normalized)) return normalized;
    }
    for (const tag of tags) {
        const normalized = normalizeUnderlyingKey(tag);
        if (!normalized) continue;
        if (TICKER_RE.test(normalized)) return normalized;
    }
    return null;
}

/** 从 explicit / symbols / tags 解析单一 underlying；无法解析返回 null。 */
export function resolveInvestEventUnderlying(input: {
    explicit?: string | null;
    symbols?: string[];
    tags?: string[];
}): string | null {
    const explicit = input.explicit?.trim();
    if (explicit) {
        const key = normalizeUnderlyingKey(explicit);
        return key || null;
    }
    const symbol = input.symbols?.find((s) => String(s ?? '').trim());
    if (symbol) {
        const key = normalizeUnderlyingKey(symbol);
        return key || null;
    }
    const fromTags = pickFromTags(input.tags);
    return fromTags ? normalizeUnderlyingKey(fromTags) : null;
}

/** signal / 批处理操作关联 ID（非业务发号）。 */
export function newSignalTraceId(): string {
    return crypto.randomUUID();
}
