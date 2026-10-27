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
