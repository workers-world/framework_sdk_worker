/**
 * Intake 平台 hop 元数据：requestId / invocationId 等写入 v2 index + observability_ref。
 * 上游：intakePublishFinalize；下游：sch1 Admin / Agent Observability 兜底查询。
 */
import {
    buildIntakePayloadEnvelope,
    buildKeyValueBlock,
    INTAKE_BLOCK_OBSERVABILITY_REF,
    type IntakeEvidenceBlock,
    type IntakePayloadEnvelope,
    type IntakePayloadIndexValue,
    isIntakePayloadEnvelope,
    type ObservabilityRefBlockData,
} from './payload-envelope.js';
import type { IntakeEvent } from './types.js';

export interface IntakeHopMeta {
    /** 平台 hop（Dashboard Invocations）；与 invocationId 同义时常填其一 */
    requestId?: string;
    invocationId?: string;
    /** W3C traceId / lineageId / storyId */
    traceId?: string;
    scriptName?: string;
    cfRay?: string;
    note?: string;
}

const OBS_BLOCK_ID = 'obs-hop';

/** 统一对外展示名：invocationId 优先，否则 requestId */
export function normalizeHopRequestId(meta: IntakeHopMeta): string | undefined {
    const id = meta.invocationId?.trim() || meta.requestId?.trim();
    return id || undefined;
}

export function hasIntakeHopMeta(meta: IntakeHopMeta | undefined | null): boolean {
    if (!meta) {
        return false;
    }
    return Boolean(
        normalizeHopRequestId(meta) ||
            meta.traceId?.trim() ||
            meta.scriptName?.trim() ||
            meta.cfRay?.trim() ||
            meta.note?.trim(),
    );
}

/** payload 是否已有可检索 hop（index.requestId 或 observability_ref） */
export function payloadHasHopPointer(payload: Record<string, unknown>): boolean {
    if (isIntakePayloadEnvelope(payload)) {
        const req = payload.index.requestId;
        if (typeof req === 'string' && req.trim()) {
            return true;
        }
        return payload.blocks.some((b) => {
            if (b.type !== INTAKE_BLOCK_OBSERVABILITY_REF) {
                return false;
            }
            const data = b.data as ObservabilityRefBlockData | undefined;
            return Boolean(data?.cfRequestId?.trim());
        });
    }
    const top = payload.requestId;
    return typeof top === 'string' && top.trim().length > 0;
}

export function buildObservabilityRefBlock(
    id: string,
    meta: IntakeHopMeta,
    options?: { title?: string },
): IntakeEvidenceBlock | null {
    const cfRequestId = normalizeHopRequestId(meta);
    if (!cfRequestId && !meta.note?.trim()) {
        return null;
    }
    const data: ObservabilityRefBlockData = {
        ...(cfRequestId ? { cfRequestId } : {}),
        ...(meta.note?.trim() ? { note: meta.note.trim() } : {}),
    };
    return {
        id,
        type: INTAKE_BLOCK_OBSERVABILITY_REF,
        title: options?.title ?? 'Workers trace',
        data,
    };
}

function mergeIndex(
    index: Record<string, IntakePayloadIndexValue>,
    meta: IntakeHopMeta,
): Record<string, IntakePayloadIndexValue> {
    const next = { ...index };
    const requestId = normalizeHopRequestId(meta);
    if (requestId) {
        next.requestId = requestId;
    }
    if (meta.traceId?.trim()) {
        next.traceId = meta.traceId.trim();
    }
    if (meta.scriptName?.trim()) {
        next.scriptName = meta.scriptName.trim();
    }
    if (meta.cfRay?.trim()) {
        next.cfRay = meta.cfRay.trim();
    }
    return next;
}

function upgradeFlatToV2(
    payload: Record<string, unknown>,
    meta: IntakeHopMeta,
): IntakePayloadEnvelope {
    const index: Record<string, IntakePayloadIndexValue> = {};
    const kvItems: Array<{ key: string; value: string }> = [];
    for (const [key, value] of Object.entries(payload)) {
        if (value == null) {
            continue;
        }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            index[key] = value;
            kvItems.push({ key, value: String(value) });
        } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
            index[key] = value as string[];
            kvItems.push({ key, value: value.join(', ') });
        }
    }
    const blocks: IntakeEvidenceBlock[] = [];
    if (kvItems.length > 0) {
        blocks.push(buildKeyValueBlock('kv-legacy', kvItems, { title: 'Details' }));
    }
    const obs = buildObservabilityRefBlock(OBS_BLOCK_ID, meta);
    if (obs) {
        blocks.push(obs);
    }
    return buildIntakePayloadEnvelope({
        index: mergeIndex(index, meta),
        blocks,
    });
}

function appendObsIfMissing(
    blocks: IntakeEvidenceBlock[],
    meta: IntakeHopMeta,
): IntakeEvidenceBlock[] {
    const requestId = normalizeHopRequestId(meta);
    if (!requestId) {
        return blocks;
    }
    const already = blocks.some((b) => {
        if (b.type !== INTAKE_BLOCK_OBSERVABILITY_REF) {
            return false;
        }
        const data = b.data as ObservabilityRefBlockData | undefined;
        return data?.cfRequestId === requestId || b.id === OBS_BLOCK_ID;
    });
    if (already) {
        return blocks;
    }
    const obs = buildObservabilityRefBlock(OBS_BLOCK_ID, meta);
    return obs ? [...blocks, obs] : blocks;
}

/** 合并 hop 进 payload；v1 扁平则升级为最小 v2 */
export function intakeMergeHopMeta(
    payload: Record<string, unknown>,
    meta: IntakeHopMeta,
): Record<string, unknown> {
    if (!hasIntakeHopMeta(meta)) {
        return payload;
    }
    if (!isIntakePayloadEnvelope(payload)) {
        return upgradeFlatToV2(payload, meta) as unknown as Record<string, unknown>;
    }
    return buildIntakePayloadEnvelope({
        index: mergeIndex(payload.index, meta),
        blocks: appendObsIfMissing(payload.blocks, meta),
        enrich: payload.enrich,
    }) as unknown as Record<string, unknown>;
}

export function intakeMergeHopMetaIntoEvent(event: IntakeEvent, meta: IntakeHopMeta): IntakeEvent {
    if (!hasIntakeHopMeta(meta)) {
        return event;
    }
    return {
        ...event,
        payload: intakeMergeHopMeta(event.payload, meta),
    };
}

/** 合并多个 hop 源：显式 > 后写入优先覆盖空字段 */
export function mergeIntakeHopMeta(...parts: Array<IntakeHopMeta | undefined>): IntakeHopMeta {
    const out: IntakeHopMeta = {};
    for (const part of parts) {
        if (!part) {
            continue;
        }
        if (part.requestId?.trim()) {
            out.requestId = part.requestId.trim();
        }
        if (part.invocationId?.trim()) {
            out.invocationId = part.invocationId.trim();
        }
        if (part.traceId?.trim()) {
            out.traceId = part.traceId.trim();
        }
        if (part.scriptName?.trim()) {
            out.scriptName = part.scriptName.trim();
        }
        if (part.cfRay?.trim()) {
            out.cfRay = part.cfRay.trim();
        }
        if (part.note?.trim()) {
            out.note = part.note.trim();
        }
    }
    return out;
}
