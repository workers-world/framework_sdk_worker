/**
 * Intake 发布作用域：Worker 入口包一层后，Ops logger 可自动解析 hop。
 * 快照语义：run/runAsync 入口的同步阶段先解析 invocationId 并快照进 scope state，
 * resolveHopFromPublishScope 只读快照、不再二次 resolve、不再回退全局 active id——
 * 模块级 currentScope / 全局 active id 在并发请求下会互相覆盖，参与解析会导致 hop 错挂。
 * 限制：currentScope 本身仍是模块级单例，并发 isolate（同 isolate 交错处理多请求）下
 * scope 仍会被后进入者覆盖——严格正确仍需显式传 hop / ctx，本快照只消除 active id 二次回退。
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

/** 从 scope 快照解析 hop（快照已在 run 入口固化 runtime id，不再回退全局 active id） */
export function resolveHopFromPublishScope(explicit?: IntakeHopMeta): IntakeHopMeta | undefined {
    const merged = mergeIntakeHopMeta(currentScope?.hop, explicit);
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

/** 入口同步阶段快照：把 runtime 解析出的 invocationId 固化进 hop，后续只读快照 */
function snapshotScope(state: IntakePublishScopeState): IntakePublishScopeState {
    const resolved = resolveWorkerInvocationId(
        state.ctx as ExecutionContext | undefined,
        state.request,
    );
    return {
        ...state,
        hop: mergeIntakeHopMeta(
            state.hop,
            resolved ? { invocationId: resolved, requestId: resolved } : undefined,
        ),
    };
}

export const intakePublishScope = {
    /**
     * 在入口 handler 包一层：同步阶段解析 invocationId 快照进 scope，
     * 便于 createOpsLogger.error 不显式传 ctx 也能带 hop。
     * 仍维护全局 active id（兼容旧读取路径），但它不参与本模块解析。
     */
    run<T>(state: IntakePublishScopeState, fn: () => T): T {
        const prevScope = currentScope;
        const prevActive = getActiveInvocationId();
        currentScope = snapshotScope(state);
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
        currentScope = snapshotScope(state);
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
