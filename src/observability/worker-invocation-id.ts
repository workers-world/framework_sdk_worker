/**
 * Workers Observability invocation / request id（Dashboard Invocations 分组键）。
 * 运行时 API 因触发类型而异；fail-open 返回 undefined。
 *
 * 从 email-rule-worker 上收，供 intakePublishFinalize / Ops 通道复用。
 */

let activeInvocationId: string | undefined;

export function setActiveInvocationId(id: string | undefined): void {
    activeInvocationId = id;
}

export function getActiveInvocationId(): string | undefined {
    return activeInvocationId;
}

export function resolveWorkerInvocationId(
    ctx?: ExecutionContext,
    request?: Request,
): string | undefined {
    const ctxRecord = ctx as { invocationId?: string; requestId?: string } | undefined;
    if (typeof ctxRecord?.invocationId === 'string' && ctxRecord.invocationId.trim()) {
        return ctxRecord.invocationId.trim();
    }
    if (typeof ctxRecord?.requestId === 'string' && ctxRecord.requestId.trim()) {
        return ctxRecord.requestId.trim();
    }
    const cf = (request as (Request & { cf?: { requestId?: string } }) | undefined)?.cf;
    if (typeof cf?.requestId === 'string' && cf.requestId.trim()) {
        return cf.requestId.trim();
    }
    return getActiveInvocationId();
}
