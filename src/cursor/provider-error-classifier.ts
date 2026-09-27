/**
 * Cursor Cloud Agent 错误分类（409 stream_unavailable 等）。
 * 契约：resilience/provider-error/types；由内置 catalog 注册。
 */

import type {
    ClassifiableError,
    ProviderErrorClassifier,
    RetryDecision,
} from '../resilience/provider-error/types.js';
import { isCursorStreamUnavailable } from './cloud-agent.js';

export const cursorProviderErrorClassifier: ProviderErrorClassifier = {
    provider: 'cursor',
    classify(input: ClassifiableError): RetryDecision | null {
        const code = (input.code ?? '').trim();
        const msg = input.message ?? '';
        if (isCursorStreamUnavailable(code, msg) || input.name === 'CursorStreamUnavailableError') {
            const attempt = input.attempt ?? 1;
            const delaySeconds = Math.min(30, 2 * attempt);
            return {
                kind: 'transient',
                retryable: true,
                delaySeconds,
                reason: 'stream_unavailable',
                action: 'reconnect',
            };
        }
        return null;
    },
};
