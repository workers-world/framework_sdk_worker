/**
 * 稳定 JSON：对象键排序后序列化，用于判断配置是否实质变更。
 */

function sortKeysDeep(value: unknown): unknown {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(sortKeysDeep);
    }
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
        out[key] = sortKeysDeep(obj[key]);
    }
    return out;
}

/** 将任意 JSON 可序列化值转为键排序后的稳定字符串 */
export function stableStringify(value: unknown): string {
    return JSON.stringify(sortKeysDeep(value));
}

/** 比较两份配置是否实质相同（键序无关） */
export function payloadsEqual(a: unknown, b: unknown): boolean {
    return stableStringify(a) === stableStringify(b);
}

export function toPayloadJson(payload: unknown): string {
    if (typeof payload === 'string') {
        return payload;
    }
    return JSON.stringify(payload);
}

export function parsePayloadJson(raw: string): unknown {
    return JSON.parse(raw) as unknown;
}

export function defaultItemCount(payload: unknown, explicit?: number): number {
    if (explicit != null && Number.isFinite(explicit)) {
        return Math.max(0, Math.floor(explicit));
    }
    if (Array.isArray(payload)) {
        return payload.length;
    }
    if (typeof payload === 'string') {
        try {
            const parsed = JSON.parse(payload) as unknown;
            if (Array.isArray(parsed)) {
                return parsed.length;
            }
        } catch {
            return 1;
        }
        return 1;
    }
    return 1;
}
