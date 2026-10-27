/**
 * Intake 发布闸：外围出站唯一公开 API。
 * 流程：intakePublishFinalize → intakePublishPost（HTTP）。
 */
import { resolveWorkerInvocationId } from '../observability/worker-invocation-id.js';
import { type IntakeHopMeta, intakeMergeHopMetaIntoEvent, mergeIntakeHopMeta } from './hop-meta.js';
import { resolveHopFromPublishScope } from './publish-scope.js';
import {
    type IntakeEnv,
    intakePublishPost,
    intakePublishPostAsync,
    validateIntakeEvent,
} from './submit.js';
import type { IntakeEvent, SubmitIntakeResult } from './types.js';

/** 生产者通道（文档 / 审计用常量） */
export type IntakeProducerChannel = 'ops' | 'artifact' | 'platform';

export const INTAKE_PRODUCER_CHANNEL_OPS = 'ops' as const satisfies IntakeProducerChannel;
export const INTAKE_PRODUCER_CHANNEL_ARTIFACT = 'artifact' as const satisfies IntakeProducerChannel;
export const INTAKE_PRODUCER_CHANNEL_PLATFORM = 'platform' as const satisfies IntakeProducerChannel;

export interface IntakePublishContext {
    ctx?: Pick<ExecutionContext, 'waitUntil'>;
    request?: Request;
    /** 显式 hop；缺省从 ctx/request / publishScope 解析 */
    hop?: IntakeHopMeta;
    /** 审计标记（不写入 payload） */
    channel?: IntakeProducerChannel;
}

export type IntakePublishResult = SubmitIntakeResult;

/** 解析并合并 hop，写入 event payload（不 POST） */
export function intakePublishFinalize(
    event: IntakeEvent,
    context?: IntakePublishContext,
): IntakeEvent {
    const fromCtx = resolveWorkerInvocationId(
        context?.ctx as ExecutionContext | undefined,
        context?.request,
    );
    const fromScope = resolveHopFromPublishScope(context?.hop);
    const hop = mergeIntakeHopMeta(
        fromScope,
        fromCtx ? { invocationId: fromCtx, requestId: fromCtx } : undefined,
        context?.hop,
    );
    const merged = intakeMergeHopMetaIntoEvent(event, hop);
    const err = validateIntakeEvent(merged);
    if (err) {
        // finalize 不抛；publish 侧用 validate 结果
        return merged;
    }
    return merged;
}

/**
 * 发布闸：finalize + POST sch1。
 * 业务 / 平台生产者应经三通道或本函数出站，勿裸 fetch /sch1/intake。
 */
export async function intakePublish(
    env: IntakeEnv,
    event: IntakeEvent,
    context?: IntakePublishContext,
): Promise<IntakePublishResult> {
    const finalized = intakePublishFinalize(event, context);
    return intakePublishPost(env, finalized);
}

/** 热路径 fire-and-forget */
export function intakePublishAsync(
    env: IntakeEnv,
    event: IntakeEvent,
    context?: IntakePublishContext,
): void {
    const finalized = intakePublishFinalize(event, context);
    intakePublishPostAsync(env, finalized, context?.ctx);
}
