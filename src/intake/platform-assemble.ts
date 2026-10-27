/**
 * Platform 通道组装：仅 orchestrator / tal1 / rev1 使用。
 * 产出半成品 IntakeEvent 后必须 {@link intakePublish}（勿裸 POST）。
 *
 * 复杂 enrich（audit-log / R2 / Observability REST）仍可在平台仓完成后再传入
 * payloadEnvelope；本模块提供命名一致的薄封装，避免业务仓 import build*Intake。
 */
import {
    buildOpsErrorIntake,
    buildOptLatencyDigestIntake,
    buildQualityClusterIntake,
    buildQualityLogDigestIntake,
} from './builders.js';
import type { IntakeHopMeta } from './hop-meta.js';
import type { IntakePayloadEnvelope } from './payload-envelope.js';
import type { IntakeEvent, IntakeLink, IntakeSeverity } from './types.js';

/** platform：遥测 error 爆发 → ops.error（由调用方填好 envelope） */
export function intakePlatformAssembleErrorBurst(input: {
    producer?: string;
    worker: string;
    reason?: string;
    error: string;
    dedupKey: string;
    requestId?: string;
    hop?: IntakeHopMeta;
    context?: Record<string, string | number | boolean>;
    payloadEnvelope: IntakePayloadEnvelope;
    summary?: string;
    severity?: IntakeSeverity;
    links?: IntakeLink[];
}): IntakeEvent {
    const event = buildOpsErrorIntake({
        producer: input.producer ?? 'orchestrator-worker',
        worker: input.worker,
        reason: input.reason ?? 'telemetry_error_burst',
        error: input.error,
        dedupKey: input.dedupKey,
        requestId: input.requestId,
        hop: input.hop,
        context: input.context,
        severity: input.severity,
        links: input.links,
    });
    event.payload = input.payloadEnvelope as unknown as Record<string, unknown>;
    if (input.summary?.trim()) {
        event.summary = input.summary.trim().slice(0, 500);
    }
    return event;
}

/** platform：质量簇（envelope 可由 orchestrator enrich 后传入） */
export function intakePlatformAssembleQualityCluster(
    input: Parameters<typeof buildQualityClusterIntake>[0],
): IntakeEvent {
    return buildQualityClusterIntake(input);
}

/** platform：质量日志日报 */
export function intakePlatformAssembleQualityLogDigest(
    input: Parameters<typeof buildQualityLogDigestIntake>[0],
): IntakeEvent {
    return buildQualityLogDigestIntake(input);
}

/** platform：延迟优化日报 */
export function intakePlatformAssembleOptLatencyDigest(
    input: Parameters<typeof buildOptLatencyDigestIntake>[0],
): IntakeEvent {
    return buildOptLatencyDigestIntake(input);
}

/** platform：tal1 未捕获异常 */
export function intakePlatformAssembleUncaughtException(input: {
    producer?: string;
    worker: string;
    error: string;
    context?: Record<string, string | number | boolean>;
    hop?: IntakeHopMeta;
    requestId?: string;
    dedupKey?: string;
    links?: IntakeLink[];
}): IntakeEvent {
    return buildOpsErrorIntake({
        producer: input.producer ?? 'tal1',
        worker: input.worker,
        reason: 'uncaught_exception',
        error: input.error,
        context: input.context,
        hop: input.hop,
        requestId: input.requestId,
        dedupKey: input.dedupKey,
        links: input.links,
    });
}
