/**
 * Cloudflare Workflow `step.do` 统一输出契约，便于 Dashboard Step History / Admin 时间线阅读。
 * 每个 step 应 return WorkflowStepResult，避免 output N/A。
 */

export type WorkflowStepStatus = 'ok' | 'skipped' | 'error';

export interface WorkflowStepResult<T = unknown> {
    status: WorkflowStepStatus;
    /** Dashboard / Admin 可读摘要（建议中文） */
    message: string;
    /** 结构化细节；无数据时为 {} */
    payload: T;
}

export function workflowStepOk<T = Record<string, never>>(
    message: string,
    payload?: T,
): WorkflowStepResult<T> {
    return {
        status: 'ok',
        message,
        payload: (payload ?? {}) as T,
    };
}

export function workflowStepSkip<T = Record<string, never>>(
    message: string,
    payload?: T,
): WorkflowStepResult<T> {
    return {
        status: 'skipped',
        message,
        payload: (payload ?? {}) as T,
    };
}

export function workflowStepErr<T = Record<string, never>>(
    message: string,
    payload?: T,
): WorkflowStepResult<T> {
    return {
        status: 'error',
        message,
        payload: (payload ?? {}) as T,
    };
}

export function isWorkflowStepResult(output: unknown): output is WorkflowStepResult {
    if (!output || typeof output !== 'object') {
        return false;
    }
    const o = output as { status?: unknown; message?: unknown; payload?: unknown };
    return (
        (o.status === 'ok' || o.status === 'skipped' || o.status === 'error') &&
        typeof o.message === 'string' &&
        'payload' in o
    );
}

/** step_completed 上表示业务失败（平台 step 仍可能 completed） */
export function isWorkflowStepError(output: unknown): boolean {
    if (!output || typeof output !== 'object') {
        return false;
    }
    return (output as { status?: string }).status === 'error';
}

/** status === skipped（勿当成功绿勾） */
export function isWorkflowStepSkipped(output: unknown): boolean {
    if (!output || typeof output !== 'object') {
        return false;
    }
    return (output as { status?: string }).status === 'skipped';
}

export function workflowStepMessage(output: unknown): string | null {
    if (!output || typeof output !== 'object') {
        return null;
    }
    const msg = (output as { message?: unknown }).message;
    return typeof msg === 'string' && msg.trim() ? msg.trim() : null;
}

export type WithWorkflowStepCatchOptions<T> = {
    /** 异常时并入 workflowStepErr 的 payload（如 { code }） */
    extraPayload?: T;
    /** catch 后副作用（写 run log 等）；不改变返回信封 */
    onCatch?: (message: string, error: unknown) => void | Promise<void>;
};

/**
 * 把 step 体抛错收成 `workflowStepErr`（平台 step 仍 completed，不会按 throw 重试）。
 * 仅用于「业务失败写信封、不要平台重试」的 step；需要重试的 step 应继续 throw。
 */
export async function withWorkflowStepCatch<T = Record<string, never>>(
    fn: () => Promise<WorkflowStepResult<T>>,
    opts?: WithWorkflowStepCatchOptions<T>,
): Promise<WorkflowStepResult<T>> {
    try {
        return await fn();
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        if (opts?.onCatch) {
            await opts.onCatch(message, e);
        }
        return workflowStepErr(message, opts?.extraPayload);
    }
}

/**
 * 从 `WorkflowStepResult` 取 payload；`error` 时调 `onError`（通常落库后 throw NonRetryableError）。
 * `ok` / `skipped` 都返回 payload（skip 不是失败）。
 */
export async function unwrapWorkflowStep<T>(
    result: WorkflowStepResult<T>,
    onError: (message: string, result: WorkflowStepResult<T>) => Promise<never> | never,
): Promise<T> {
    if (isWorkflowStepError(result)) {
        await onError(result.message || 'step error', result);
    }
    return result.payload;
}
