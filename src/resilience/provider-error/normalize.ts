import { messageOf } from './internal.js';
import type { ClassifiableError } from './types.js';

/** 从 thrown / HTTP 错误归一化为 ClassifiableError */
export function classifiableFromUnknown(error: unknown): ClassifiableError {
    if (error && typeof error === 'object') {
        const o = error as Record<string, unknown>;
        const status = typeof o.status === 'number' ? o.status : undefined;
        const headers =
            o.response && typeof o.response === 'object'
                ? (o.response as { headers?: Record<string, string> }).headers
                : undefined;
        return {
            status,
            code: typeof o.code === 'string' ? o.code : undefined,
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
