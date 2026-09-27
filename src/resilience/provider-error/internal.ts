import type { RetryDecision } from './types.js';

export const GIVE_UP: RetryDecision = {
    kind: 'permanent',
    retryable: false,
    reason: 'permanent',
    action: 'give_up',
};

export function headerRetryAfterSec(
    headers?: Record<string, string | undefined>,
): number | undefined {
    const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
    if (!raw) {
        return undefined;
    }
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function messageOf(e: unknown): string {
    if (e instanceof Error) {
        return e.message;
    }
    return String(e ?? '');
}
