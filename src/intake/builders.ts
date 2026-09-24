import { hashString, type LogFields, normalizeError, sanitizeForLog } from '../ops-error.js';
import { shanghaiIsoString, shanghaiYmdDash } from '../time.js';
import {
    INTAKE_KIND_DESK_DRAFT_QUALITY,
    INTAKE_KIND_DESK_OBS_DUMP,
    INTAKE_KIND_OPS_ERROR,
    INTAKE_KIND_OPT_LATENCY_DIGEST,
    INTAKE_KIND_QUALITY_ARTIFACT,
    INTAKE_KIND_QUALITY_CLUSTER,
    INTAKE_KIND_QUALITY_LOG_DIGEST,
} from './kinds.js';
import type { IntakePayloadEnvelope } from './payload-envelope.js';
import type { IntakeEvent, IntakeLink, IntakeSeverity } from './types.js';

export interface OpsErrorIntakePayload {
    reason: string;
    error: string;
    context?: Record<string, string | number | boolean>;
    requestId?: string;
}

/** quality_capture detail 诊断子集 */
export interface QualityClusterAuditCaptureParsed {
    timelineCount?: number;
    logsCaptured?: boolean;
    captureError?: string;
}

/** quality_diagnosis detail 诊断子集 */
export interface QualityClusterAuditDiagnosisParsed {
    status?: string;
    agentId?: string;
    rootCause?: string;
    isBug?: boolean;
    suspectedLayer?: string;
    recommendation?: string;
    suspectedFiles?: string[];
}

/** quality_fix detail 诊断子集 */
export interface QualityClusterAuditFixParsed {
    status?: string;
    prUrl?: string;
}

/** Agent 链路单行（audit-log maintenance_log 映射） */
export interface QualityClusterAuditLogRef {
    id: number;
    ts: string;
    action: string;
    service: string;
    target: string;
    traceId: string;
    /** 截断后的 detail JSON 原文（兜底） */
    detailPreview?: string;
    /** 从 detail 提取的可读诊断子结构 */
    parsed?: {
        capture?: QualityClusterAuditCaptureParsed;
        diagnosis?: QualityClusterAuditDiagnosisParsed;
        fix?: QualityClusterAuditFixParsed;
    };
}

export interface QualityClusterCaseRef {
    dedupKey: string;
    worker?: string;
    ruleId?: string;
    kind?: string;
    /** = dedupKey；便于反查 audit-log */
    auditLogTraceId?: string;
    /** 按 ts 升序的 Agent 链路（capture → diagnosis → fix） */
    auditLogs?: QualityClusterAuditLogRef[];
}

export interface QualityClusterAuditEnrich {
    fetchedAt: string;
    truncated?: boolean;
    purpose: 'agent_diagnosis_chain';
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
    /** 入站前从 audit-log enrich 的元数据 */
    auditEnrich?: QualityClusterAuditEnrich;
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
    const items: Array<{ key: string; value: string }> = [
        { key: 'reason', value: input.reason },
        { key: 'worker', value: input.worker },
        { key: 'error', value: error },
    ];
    for (const [key, value] of Object.entries(safeContext)) {
        items.push({ key, value: String(value) });
    }
    if (input.requestId) {
        items.push({ key: 'requestId', value: input.requestId });
    }
    const payload = {
        payloadVersion: 2 as const,
        index: {
            reason: input.reason,
            worker: input.worker,
            ...(input.requestId ? { requestId: input.requestId } : {}),
        },
        blocks: [
            {
                id: 'kv-ops',
                type: 'intake.key_value',
                title: 'ops.error',
                data: { items },
            },
        ],
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
    auditEnrich?: QualityClusterAuditEnrich;
    /** v2 通用 envelope；提供时取代扁平 QualityClusterIntakePayload */
    payloadEnvelope?: IntakePayloadEnvelope;
    worker?: string;
    severity?: IntakeSeverity;
    occurredAt?: string;
    dedupKey?: string;
    links?: IntakeLink[];
}): IntakeEvent {
    const payload: QualityClusterIntakePayload | IntakePayloadEnvelope = input.payloadEnvelope ?? {
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
        ...(input.auditEnrich ? { auditEnrich: input.auditEnrich } : {}),
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
    payloadEnvelope?: IntakePayloadEnvelope;
    severity?: IntakeSeverity;
    occurredAt?: string;
    dedupKey?: string;
    links?: IntakeLink[];
}): IntakeEvent {
    const payload: QualityLogDigestIntakePayload | IntakePayloadEnvelope =
        input.payloadEnvelope ?? {
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

export interface DeskDraftQualityIntakePayload {
    lineageId: string;
    draftId?: number;
    underlying?: string;
    reason: string;
    primaryRepo?: string;
}

export interface DeskObsDumpIntakePayload {
    lineageId: string;
    draftId?: number;
    underlying?: string;
    purpose: 'full_dump' | 'lite';
    primaryRepo?: string;
}

/** desk.draft_quality 轻量 Intake（Phase 4） */
export function buildDeskDraftQualityDedupKey(lineageId: string, reason: string): string {
    const day = shanghaiYmdDash();
    return `${INTAKE_KIND_DESK_DRAFT_QUALITY}:${lineageId}:${reason}:${day}`;
}

export function buildDeskDraftQualityIntake(input: {
    producer?: string;
    lineageId: string;
    draftId?: number;
    underlying?: string;
    reason: string;
    primaryRepo?: string;
    payloadEnvelope?: IntakePayloadEnvelope;
    severity?: IntakeSeverity;
    occurredAt?: string;
    dedupKey?: string;
    links?: IntakeLink[];
}): IntakeEvent {
    const payload: DeskDraftQualityIntakePayload | IntakePayloadEnvelope =
        input.payloadEnvelope ?? {
            lineageId: input.lineageId,
            ...(input.draftId != null ? { draftId: input.draftId } : {}),
            ...(input.underlying ? { underlying: input.underlying } : {}),
            reason: input.reason,
            ...(input.primaryRepo ? { primaryRepo: input.primaryRepo } : {}),
        };
    const title = truncate(
        `desk 草稿质量 · ${input.underlying ?? input.lineageId.slice(0, 8)} · ${input.reason}`,
        120,
    );
    const summary = truncate(
        `lineageId=${input.lineageId}${input.draftId != null ? ` draftId=${input.draftId}` : ''}`,
        500,
    );
    return {
        schemaVersion: 1,
        kind: INTAKE_KIND_DESK_DRAFT_QUALITY,
        dedupKey:
            input.dedupKey?.trim() || buildDeskDraftQualityDedupKey(input.lineageId, input.reason),
        source: {
            producer: input.producer ?? 'decision-desk-worker',
            worker: 'decision-desk-worker',
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

/** desk.obs_dump 全量观测包（Phase 6） */
export function buildDeskObsDumpDedupKey(lineageId: string, date?: string): string {
    const day = date ?? shanghaiYmdDash();
    return `${INTAKE_KIND_DESK_OBS_DUMP}:${lineageId}:dump:${day}`;
}

export function buildDeskObsDumpIntake(input: {
    producer?: string;
    lineageId: string;
    draftId?: number;
    underlying?: string;
    primaryRepo?: string;
    payloadEnvelope: IntakePayloadEnvelope;
    severity?: IntakeSeverity;
    occurredAt?: string;
    dedupKey?: string;
    links?: IntakeLink[];
}): IntakeEvent {
    const title = truncate(
        `desk 观测导出 · ${input.underlying ?? input.lineageId.slice(0, 8)}`,
        120,
    );
    const summary = truncate(`全量 lineage 观测包 · ${input.lineageId}`, 500);
    return {
        schemaVersion: 1,
        kind: INTAKE_KIND_DESK_OBS_DUMP,
        dedupKey: input.dedupKey?.trim() || buildDeskObsDumpDedupKey(input.lineageId),
        source: {
            producer: input.producer ?? 'decision-desk-worker',
            worker: 'decision-desk-worker',
            repo: input.primaryRepo,
        },
        title,
        summary,
        severity: input.severity ?? 'info',
        occurredAt: input.occurredAt ?? shanghaiIsoString(),
        payload: input.payloadEnvelope as unknown as Record<string, unknown>,
        links: input.links,
    };
}

/** opt.latency_digest：一日一行，payload 必须是 v2 envelope */
export function buildOptLatencyDigestDedupKey(date: string): string {
    return `${INTAKE_KIND_OPT_LATENCY_DIGEST}:${date}`;
}

export function buildOptLatencyDigestIntake(input: {
    date: string;
    payloadEnvelope: IntakePayloadEnvelope;
    producer?: string;
    severity?: IntakeSeverity;
    occurredAt?: string;
    summary?: string;
    links?: IntakeLink[];
}): IntakeEvent {
    const cellCount = input.payloadEnvelope.index.cellCount;
    return {
        schemaVersion: 1,
        kind: INTAKE_KIND_OPT_LATENCY_DIGEST,
        dedupKey: buildOptLatencyDigestDedupKey(input.date),
        source: {
            producer: input.producer ?? 'orchestrator-worker',
            worker: 'orchestrator-worker',
        },
        title: truncate(`优化延迟日报 ${input.date}`, 120),
        summary: truncate(
            input.summary ?? `Observability calculations Top-N · cells=${cellCount ?? 0}`,
            500,
        ),
        severity: input.severity ?? 'info',
        occurredAt: input.occurredAt ?? shanghaiIsoString(),
        payload: input.payloadEnvelope as unknown as Record<string, unknown>,
        links: input.links,
    };
}

/** quality.artifact 通用产物通道 dedup */
export function buildQualityArtifactDedupKey(input: {
    worker: string;
    artifactType: string;
    storyId: string;
    mode: 'lite' | 'dump';
    reason?: string;
    date?: string;
}): string {
    const day = input.date ?? shanghaiYmdDash();
    const tail = input.mode === 'dump' ? 'dump' : input.reason?.trim() || 'unknown';
    return `${INTAKE_KIND_QUALITY_ARTIFACT}:${input.worker}:${input.artifactType}:${input.storyId}:${tail}:${day}`;
}

export function buildQualityArtifactIntake(input: {
    worker: string;
    artifactType: string;
    mode: 'lite' | 'dump';
    storyId: string;
    reason?: string;
    primaryRepo?: string;
    producer?: string;
    title?: string;
    summary?: string;
    payloadEnvelope: IntakePayloadEnvelope;
    severity?: IntakeSeverity;
    occurredAt?: string;
    dedupKey?: string;
    links?: IntakeLink[];
    /** 存量兼容：desk.draft_quality / desk.obs_dump */
    kindOverride?: string;
}): IntakeEvent {
    const kind = input.kindOverride?.trim() || INTAKE_KIND_QUALITY_ARTIFACT;
    const modeLabel = input.mode === 'dump' ? '观测包' : '质量';
    const title = truncate(
        input.title?.trim() ||
            `${input.artifactType} ${modeLabel} · ${input.storyId.slice(0, 8)}${input.reason ? ` · ${input.reason}` : ''}`,
        120,
    );
    const summary = truncate(
        input.summary?.trim() ||
            `storyId=${input.storyId} mode=${input.mode}${input.reason ? ` reason=${input.reason}` : ''}`,
        500,
    );
    let dedupKey = input.dedupKey?.trim();
    if (!dedupKey) {
        if (kind === INTAKE_KIND_DESK_DRAFT_QUALITY) {
            dedupKey = buildDeskDraftQualityDedupKey(
                input.storyId,
                input.reason?.trim() || 'unknown',
            );
        } else if (kind === INTAKE_KIND_DESK_OBS_DUMP) {
            dedupKey = buildDeskObsDumpDedupKey(input.storyId);
        } else {
            dedupKey = buildQualityArtifactDedupKey({
                worker: input.worker,
                artifactType: input.artifactType,
                storyId: input.storyId,
                mode: input.mode,
                reason: input.reason,
            });
        }
    }
    return {
        schemaVersion: 1,
        kind,
        dedupKey,
        source: {
            producer: input.producer ?? input.worker,
            worker: input.worker,
            repo: input.primaryRepo,
        },
        title,
        summary,
        severity: input.severity ?? (input.mode === 'dump' ? 'info' : 'warn'),
        occurredAt: input.occurredAt ?? shanghaiIsoString(),
        payload: input.payloadEnvelope as unknown as Record<string, unknown>,
        links: input.links,
    };
}
