import { messageOf } from './internal.js';
import type { ClassifiableError } from './types.js';

function readInternalCode(o: Record<string, unknown>): number | undefined {
    if (typeof o.internalCode === 'number' && Number.isFinite(o.internalCode)) {
        return o.internalCode;
    }
    if (typeof o.code === 'number' && Number.isFinite(o.code)) {
        return o.code;
    }
    return undefined;
}

/** 从 thrown / HTTP 错误归一化为 ClassifiableError */
export function classifiableFromUnknown(error: unknown): ClassifiableError {
    if (error && typeof error === 'object') {
        const o = error as Record<string, unknown>;
        const status = typeof o.status === 'number' ? o.status : undefined;
        const headers =
            o.response && typeof o.response === 'object'
                ? (o.response as { headers?: Record<string, string> }).headers
                : undefined;
        const code = typeof o.code === 'string' ? o.code : undefined;
        return {
            status,
            code,
            internalCode: readInternalCode(o),
            message: messageOf(error),
            name: error instanceof Error ? error.name : undefined,
            headers,
        };
    }
    return { message: messageOf(error) };
}

export function isWholesaleRateLimitMessage(message: string): boolean {
    if (!message) {
        return false;
    }
    if (/\b2018\b/.test(message)) {
        return true;
    }
    return /wholesale\s+rate\s+limit/i.test(message);
}
