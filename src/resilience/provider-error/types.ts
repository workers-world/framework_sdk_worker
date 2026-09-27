/**
 * Provider 错误分类契约（无实现）。
 * 调用方与注册表只依赖本文件类型；各 provider 码表在
 * cursor/github/ai/r2 的 provider-error-classifier.ts。
 */

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
    /** 认不出返回 null，交给链上下一个 classifier */
    classify(input: ClassifiableError): RetryDecision | null;
}
