/**
 * Intake 发布作用域：Worker 入口包一层后，Ops logger 可自动解析 hop。
 * 与 setActiveInvocationId 配合：进入 scope 时解析并 set，退出时 restore。
 */
import {
    getActiveInvocationId,
    resolveWorkerInvocationId,
    setActiveInvocationId,
} from '../observability/worker-invocation-id.js';
import type { IntakeHopMeta } from './hop-meta.js';
import { mergeIntakeHopMeta } from './hop-meta.js';

export interface IntakePublishScopeState {
    ctx?: Pick<ExecutionContext, 'waitUntil'>;
    request?: Request;
    hop?: IntakeHopMeta;
}

let currentScope: IntakePublishScopeState | undefined;

export function getIntakePublishScope(): IntakePublishScopeState | undefined {
    return currentScope;
}

/** 从当前 scope + active invocation 解析 hop */
export function resolveHopFromPublishScope(explicit?: IntakeHopMeta): IntakeHopMeta | undefined {
    const scope = currentScope;
    const fromRuntime = resolveWorkerInvocationId(
        scope?.ctx as ExecutionContext | undefined,
        scope?.request,
    );
    const merged = mergeIntakeHopMeta(
        scope?.hop,
        fromRuntime ? { invocationId: fromRuntime, requestId: fromRuntime } : undefined,
        explicit,
    );
    if (
        !merged.requestId &&
        !merged.invocationId &&
        !merged.traceId &&
        !merged.scriptName &&
        !merged.cfRay
    ) {
        return undefined;
    }
    return merged;
}

export const intakePublishScope = {
    /**
     * 在入口 handler 包一层：解析 invocationId 写入 ALS 等价（模块级 active id），
     * 便于 createOpsLogger.error 不显式传 ctx 也能带 hop。
     */
    run<T>(state: IntakePublishScopeState, fn: () => T): T {
        const prevScope = currentScope;
        const prevActive = getActiveInvocationId();
        currentScope = state;
        const resolved = resolveWorkerInvocationId(
            state.ctx as ExecutionContext | undefined,
            state.request,
        );
        if (resolved) {
            setActiveInvocationId(resolved);
        }
        try {
            return fn();
        } finally {
            currentScope = prevScope;
            setActiveInvocationId(prevActive);
        }
    },

    async runAsync<T>(state: IntakePublishScopeState, fn: () => Promise<T>): Promise<T> {
        const prevScope = currentScope;
        const prevActive = getActiveInvocationId();
        currentScope = state;
        const resolved = resolveWorkerInvocationId(
            state.ctx as ExecutionContext | undefined,
            state.request,
        );
        if (resolved) {
            setActiveInvocationId(resolved);
        }
        try {
            return await fn();
        } finally {
            currentScope = prevScope;
            setActiveInvocationId(prevActive);
        }
    },
};
