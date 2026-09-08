import { hashString, normalizeError } from '../ops-error/normalize.js';
import { type LogFields, sanitizeForLog } from '../ops-error/sanitize.js';
import { shanghaiIsoString, shanghaiYmdDash } from '../time/index.js';
import {
    INTAKE_KIND_OPS_ERROR,
    INTAKE_KIND_QUALITY_CLUSTER,
    INTAKE_KIND_QUALITY_LOG_DIGEST,
} from './kinds.js';
import type { IntakeEvent, IntakeLink, IntakeSeverity } from './types.js';

export interface OpsErrorIntakePayload {
    reason: string;
    error: string;
    context?: Record<string, string | number | boolean>;
    requestId?: string;
}

export interface QualityClusterCaseRef {
    dedupKey: string;
    worker?: string;
    ruleId?: string;
    kind?: string;
    auditLogTraceId?: string;
}

export interface QualityClusterIntakePayload {
    clusterId: string;
    windowStart: string;
    windowEnd: string;
    caseCount: number;
    hardCount: number;
    primaryRepo?: string;
    cases: QualityClusterCaseRef[];
    diagnosisSummary?: string;
}

export interface QualityLogDigestIntakePayload {
    digestDate: string;
    partIndex: number;
    partTotal: number;
    captureCount: number;
    repos: string[];
    analyzeMode: 'batch' | 'per_case';
    attachmentNames: string[];
    bugCaseCount?: number;
    baselineCeiling?: string;
}

function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** ops.error dedupKey：ops.error:{worker}:{reason}:{hash}:{day} */
export function buildOpsErrorDedupKey(worker: string, reason: string, error: string): string {
    const day = shanghaiYmdDash();
    const normalized = normalizeError(error);
    return `${INTAKE_KIND_OPS_ERROR}:${worker}:${reason}:${hashString(normalized)}:${day}`;
}

export function buildOpsErrorIntake(input: {
    producer: string;
    worker: string;
    reason: string;
    error: string;
    context?: LogFields;
    requestId?: string;
    severity?: IntakeSeverity;
    occurredAt?: string;
    dedupKey?: string;
    links?: IntakeLink[];
}): IntakeEvent {
    const context = sanitizeForLog(input.context ?? {});
    const safeContext: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(context)) {
        if (value == null) {
            continue;
        }
        if (typeof value === 'object') {
            safeContext[key] = JSON.stringify(value);
        } else {
            safeContext[key] = value as string | number | boolean;
        }
    }
    const error = truncate(String(input.error).trim(), 800);
    const payload: OpsErrorIntakePayload = {
        reason: input.reason,
        error,
        ...(Object.keys(safeContext).length > 0 ? { context: safeContext } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
    };
    const title = truncate(`[${input.worker}] ${input.reason}`, 120);
    const summary = truncate(error, 500);
    return {
        schemaVersion: 1,
        kind: INTAKE_KIND_OPS_ERROR,
        dedupKey:
            input.dedupKey?.trim() ||
            buildOpsErrorDedupKey(input.worker, input.reason, input.error),
        source: { producer: input.producer, worker: input.worker },
        title,
        summary,
        severity: input.severity ?? 'error',
        occurredAt: input.occurredAt ?? shanghaiIsoString(),
        payload: payload as unknown as Record<string, unknown>,
        links: input.links,
    };
}

export function buildQualityClusterIntake(input: {
    producer?: string;
    clusterId: string;
    windowStart: string;
    windowEnd: string;
    caseCount: number;
    hardCount: number;
    primaryRepo?: string;
    cases: QualityClusterCaseRef[];
    diagnosisSummary?: string;
    worker?: string;
    severity?: IntakeSeverity;
    occurredAt?: string;
    dedupKey?: string;
    links?: IntakeLink[];
}): IntakeEvent {
    const payload: QualityClusterIntakePayload = {
        clusterId: input.clusterId,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        caseCount: input.caseCount,
        hardCount: input.hardCount,
        cases: input.cases,
        ...(input.primaryRepo ? { primaryRepo: input.primaryRepo } : {}),
        ...(input.diagnosisSummary
            ? { diagnosisSummary: truncate(input.diagnosisSummary, 2000) }
            : {}),
    };
    const title = truncate(`质量簇 ${input.clusterId} · ${input.caseCount} case`, 120);
    const summary = truncate(
        `窗口 ${input.windowStart} ~ ${input.windowEnd}；hard=${input.hardCount}`,
        500,
    );
    return {
        schemaVersion: 1,
        kind: INTAKE_KIND_QUALITY_CLUSTER,
        dedupKey: input.dedupKey?.trim() || `${INTAKE_KIND_QUALITY_CLUSTER}:${input.clusterId}`,
        source: {
            producer: input.producer ?? 'orchestrator-worker',
            worker: input.worker,
            repo: input.primaryRepo,
        },
        title,
        summary,
        severity: input.severity ?? 'warn',
        occurredAt: input.occurredAt ?? shanghaiIsoString(),
        payload: payload as unknown as Record<string, unknown>,
        links: input.links,
    };
}

export function buildQualityLogDigestIntake(input: {
    producer?: string;
    digestDate: string;
    partIndex: number;
    partTotal: number;
    captureCount: number;
    repos: string[];
    analyzeMode: 'batch' | 'per_case';
    attachmentNames: string[];
    bugCaseCount?: number;
    baselineCeiling?: string;
    severity?: IntakeSeverity;
    occurredAt?: string;
    dedupKey?: string;
    links?: IntakeLink[];
}): IntakeEvent {
    const payload: QualityLogDigestIntakePayload = {
        digestDate: input.digestDate,
        partIndex: input.partIndex,
        partTotal: input.partTotal,
        captureCount: input.captureCount,
        repos: input.repos,
        analyzeMode: input.analyzeMode,
        attachmentNames: input.attachmentNames,
        ...(input.bugCaseCount != null ? { bugCaseCount: input.bugCaseCount } : {}),
        ...(input.baselineCeiling ? { baselineCeiling: input.baselineCeiling } : {}),
    };
    const title = truncate(
        `质量日志日报 ${input.digestDate} · part ${input.partIndex}/${input.partTotal}`,
        120,
    );
    const summary = truncate(
        `${input.captureCount} capture · repos=${input.repos.slice(0, 3).join(', ') || '—'}`,
        500,
    );
    return {
        schemaVersion: 1,
        kind: INTAKE_KIND_QUALITY_LOG_DIGEST,
        dedupKey:
            input.dedupKey?.trim() ||
            `${INTAKE_KIND_QUALITY_LOG_DIGEST}:${input.digestDate}:part-${input.partIndex}`,
        source: {
            producer: input.producer ?? 'orchestrator-worker',
            repo: input.repos[0],
        },
        title,
        summary,
        severity: input.severity ?? 'info',
        occurredAt: input.occurredAt ?? shanghaiIsoString(),
        payload: payload as unknown as Record<string, unknown>,
        links: input.links,
    };
}
