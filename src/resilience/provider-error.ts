/**
 * 外部 Provider 错误分类：个性化逻辑在各类 Classifier，调用方只走 classifyProviderError。
 * 上游：Queue consumer、Workflow retries.delay、GitHub Octokit hook、Cursor SSE runner。
 * 下游：与 circuit-breaker 分工（本模块只判 kind/delay，不断路）。
 */
import { isCursorStreamUnavailable } from '../cursor/cloud-agent.js';
import { isRetryableR2Error } from '../r2/retry.js';

export type RetryKind = 'quota' | 'rate_limit' | 'transient' | 'permanent';

export type RetryAction = 'retry' | 'defer_until' | 'reconnect' | 'give_up';

export interface RetryDecision {
    kind: RetryKind;
    retryable: boolean;
    /** Queue retry({ delaySeconds }) / Workflow retries.delay */
    delaySeconds?: number;
    reason: string;
    action: RetryAction;
}

export interface ClassifiableError {
    status?: number;
    code?: string;
    message?: string;
    name?: string;
    headers?: Record<string, string | undefined>;
    /** 当前重试序号（Workflow ctx.attempt 等），用于动态 delay */
    attempt?: number;
}

export interface ProviderErrorClassifier {
    readonly provider: string;
    classify(input: ClassifiableError): RetryDecision | null;
}

const GIVE_UP: RetryDecision = {
    kind: 'permanent',
    retryable: false,
    reason: 'permanent',
    action: 'give_up',
};

function headerRetryAfterSec(headers?: Record<string, string | undefined>): number | undefined {
    const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
    if (!raw) {
        return undefined;
    }
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

function messageOf(e: unknown): string {
    if (e instanceof Error) {
        return e.message;
    }
    return String(e ?? '');
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

function isNeuronQuotaMessage(message: string): boolean {
    const m = message.toLowerCase();
    return (
        m.includes('4006') ||
        m.includes('neuron_quota') ||
        m.includes('daily free allocation') ||
        m.includes('neurons 配额')
    );
}

function isGithubSecondaryRateLimit(status: number | undefined, message: string): boolean {
    if (status !== 403) {
        return false;
    }
    const m = message.toLowerCase();
    return m.includes('secondary rate limit') || m.includes('abuse detection');
}

const cursorClassifier: ProviderErrorClassifier = {
    provider: 'cursor',
    classify(input) {
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

const githubClassifier: ProviderErrorClassifier = {
    provider: 'github',
    classify(input) {
        const status = input.status;
        const message = input.message ?? '';
        if (status === 429 || isGithubSecondaryRateLimit(status, message)) {
            const delaySeconds = headerRetryAfterSec(input.headers) ?? (status === 429 ? 60 : 120);
            return {
                kind: 'rate_limit',
                retryable: true,
                delaySeconds,
                reason: status === 429 ? 'github_429' : 'github_secondary_rate_limit',
                action: 'retry',
            };
        }
        if (status != null && status >= 500) {
            return {
                kind: 'transient',
                retryable: true,
                delaySeconds: 2,
                reason: 'github_5xx',
                action: 'retry',
            };
        }
        if (status != null && status >= 400 && status < 500) {
            return { ...GIVE_UP, reason: `github_${status}` };
        }
        if (status == null && message.toLowerCase().includes('fetch failed')) {
            return {
                kind: 'transient',
                retryable: true,
                delaySeconds: 2,
                reason: 'github_network',
                action: 'retry',
            };
        }
        return null;
    },
};

const llmGatewayClassifier: ProviderErrorClassifier = {
    provider: 'llm-gateway',
    classify(input) {
        const message = input.message ?? '';
        if (isNeuronQuotaMessage(message)) {
            return {
                kind: 'quota',
                retryable: true,
                reason: 'neuron_4006',
                action: 'defer_until',
            };
        }
        if (isWholesaleRateLimitMessage(message) || input.status === 429) {
            return {
                kind: 'rate_limit',
                retryable: true,
                delaySeconds: headerRetryAfterSec(input.headers) ?? 60,
                reason: 'wholesale_2018',
                action: 'retry',
            };
        }
        return null;
    },
};

const r2Classifier: ProviderErrorClassifier = {
    provider: 'r2',
    classify(input) {
        const err = input.message ? new Error(input.message) : new Error('');
        if (isRetryableR2Error(err)) {
            return {
                kind: 'transient',
                retryable: true,
                delaySeconds: 1,
                reason: 'r2_transient',
                action: 'retry',
            };
        }
        return null;
    },
};

const genericClassifier: ProviderErrorClassifier = {
    provider: 'generic',
    classify(input) {
        const status = input.status;
        if (status === 429) {
            return {
                kind: 'rate_limit',
                retryable: true,
                delaySeconds: headerRetryAfterSec(input.headers) ?? 30,
                reason: 'http_429',
                action: 'retry',
            };
        }
        if (status != null && status >= 500) {
            return {
                kind: 'transient',
                retryable: true,
                delaySeconds: 2,
                reason: 'http_5xx',
                action: 'retry',
            };
        }
        if (status != null && status >= 400 && status < 500) {
            return { ...GIVE_UP, reason: `http_${status}` };
        }
        return null;
    },
};

const REGISTRY = new Map<string, ProviderErrorClassifier>([
    ['cursor', cursorClassifier],
    ['github', githubClassifier],
    ['llm-gateway', llmGatewayClassifier],
    ['r2', r2Classifier],
]);

export function registerProviderErrorClassifier(classifier: ProviderErrorClassifier): void {
    REGISTRY.set(classifier.provider, classifier);
}

/** 认不出时走 generic；仍无匹配则 permanent give_up */
export function classifyProviderError(provider: string, input: ClassifiableError): RetryDecision {
    const chain = [REGISTRY.get(provider), genericClassifier];
    for (const clf of chain) {
        if (!clf) {
            continue;
        }
        const hit = clf.classify(input);
        if (hit) {
            return hit;
        }
    }
    return { ...GIVE_UP, reason: 'unknown' };
}

/** llm-gateway-worker wholesale 检测（分类逻辑权威在 SDK） */
export function isWholesaleRateLimitError(e: unknown): boolean {
    const d = classifyProviderError('llm-gateway', classifiableFromUnknown(e));
    return d.reason === 'wholesale_2018';
}

/** GitHub Octokit hook：是否应退避重试 */
export function isGithubRequestRetryable(error: unknown, method: string): boolean {
    const idempotent = method === 'GET' || method === 'HEAD';
    const input = classifiableFromUnknown(error);
    const d = classifyProviderError('github', input);
    if (!d.retryable) {
        return false;
    }
    if (!idempotent && d.kind !== 'rate_limit') {
        return false;
    }
    return true;
}

export function githubRetryDelayMs(error: unknown, attemptIndex: number): number {
    const d = classifyProviderError('github', {
        ...classifiableFromUnknown(error),
        attempt: attemptIndex + 1,
    });
    if (d.kind === 'rate_limit' && d.delaySeconds != null) {
        return d.delaySeconds * 1000;
    }
    if (d.reason === 'github_5xx' || d.reason === 'github_network') {
        return [500, 1000][attemptIndex] ?? 1000;
    }
    const sec = d.delaySeconds ?? [1, 2][attemptIndex] ?? 2;
    return sec * 1000;
}
