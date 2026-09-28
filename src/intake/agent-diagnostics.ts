/**
 * CF Agents diagnostics → 故事级 Intake（一 traceId 一行）。
 * 上游：Tail Worker diagnosticsChannelEvents。
 * 下游：sch1 upsertIntakeEvent / submitIntakeEvent。
 */

import { buildCfAgentsDashboardUrl } from '../observability/cf-agents.js';
import { sanitizeForLog } from '../ops-error/sanitize.js';
import { shanghaiIsoString } from '../time.js';
import { INTAKE_KIND_AGENT_DIAGNOSTICS } from './kinds.js';
import {
    buildAttachmentRefBlock,
    buildIntakePayloadEnvelope,
    buildKeyValueBlock,
    INTAKE_BLOCK_CF_AGENTS_REF,
    INTAKE_BLOCK_WORKER_IO_STREAM,
    type IntakeEvidenceBlock,
    type IntakePayloadEnvelope,
    type IntakePayloadIndexValue,
    isIntakePayloadEnvelope,
    readPayloadBlocks,
    readPayloadIndex,
} from './payload-envelope.js';
import type { QualityArtifactEnv } from './submit-artifact.js';
import { putIntakeOverflowJson, QUALITY_ARTIFACT_INLINE_MAX_BYTES } from './submit-artifact.js';
import type { IntakeEvent, IntakeLink, IntakeSeverity } from './types.js';

/** 内联事件流上限（与 quality artifact 一致） */
export const AGENT_DIAGNOSTICS_INLINE_MAX_BYTES = QUALITY_ARTIFACT_INLINE_MAX_BYTES;

/** 溢出时 payload 内保留的最近事件条数 */
export const AGENT_DIAGNOSTICS_RECENT_INLINE = 40;

export type AgentDiagnosticsChannelEvent = {
    channel?: string;
    message?: unknown;
    timestamp?: number;
};

export type AgentDiagnosticsTailItem = {
    scriptName?: string | null;
    eventTimestamp?: number;
    /** 部分 runtime 暴露的 W3C / CF trace id */
    traceId?: string | null;
    diagnosticsChannelEvents?: AgentDiagnosticsChannelEvent[] | null;
};

export type NormalizedAgentDiagnosticEvent = {
    ts: number;
    channel: string;
    type: string;
    agent?: string;
    name?: string;
    message: Record<string, unknown>;
    /** 稳定去重键 */
    eventKey: string;
};

export type AgentDiagnosticsStoryState = {
    worker: string;
    traceId: string;
    conversationId?: string;
    events: NormalizedAgentDiagnosticEvent[];
    complete: boolean;
    completedAt?: string;
    agentName?: string;
    agentInstance?: string;
};

function asString(v: unknown): string | null {
    if (v == null) {
        return null;
    }
    const s = String(v).trim();
    return s || null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        return v as Record<string, unknown>;
    }
    return null;
}

/** W3C traceparent：00-{32hex}-{16hex}-… */
export function extractTraceIdFromTraceparent(value: string | null | undefined): string | null {
    if (!value?.trim()) {
        return null;
    }
    const m = /^\s*[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}\s*$/i.exec(value);
    return m ? m[1].toLowerCase() : null;
}

/** 裸 32 位 hex traceId */
export function isW3cTraceId(value: string | null | undefined): boolean {
    return Boolean(value && /^[0-9a-f]{32}$/i.test(value.trim()));
}

/**
 * traceId 解析优先级（WW-23 写死）：
 * 1. message.conversationId / payload.conversationId / lineageId
 * 2. message.traceId / payload.traceId / tail.traceId / W3C traceparent
 * 3. unknown:{scriptName}:{eventTimestamp}
 */
export function resolveAgentDiagnosticsTraceId(input: {
    message?: unknown;
    tailTraceId?: string | null;
    scriptName?: string | null;
    eventTimestamp?: number;
}): { traceId: string; conversationId?: string; source: string } {
    const msg = asRecord(input.message);
    const payload = asRecord(msg?.payload);

    const conversationId =
        asString(msg?.conversationId) ??
        asString(payload?.conversationId) ??
        asString(msg?.lineageId) ??
        asString(payload?.lineageId) ??
        undefined;

    if (conversationId) {
        return { traceId: conversationId, conversationId, source: 'conversationId' };
    }

    const candidates = [
        asString(msg?.traceId),
        asString(payload?.traceId),
        asString(input.tailTraceId),
        extractTraceIdFromTraceparent(asString(msg?.traceparent)),
        extractTraceIdFromTraceparent(asString(payload?.traceparent)),
    ];
    for (const c of candidates) {
        if (!c) {
            continue;
        }
        if (isW3cTraceId(c)) {
            return { traceId: c.toLowerCase(), source: 'traceId' };
        }
        // 非 hex 也可用（DO name 等），但 conversationId 已优先
        if (c.length >= 8 && c.length <= 128) {
            return { traceId: c, source: 'traceId' };
        }
    }

    const script = asString(input.scriptName) ?? 'unknown-script';
    const ts = input.eventTimestamp ?? 0;
    return {
        traceId: `unknown:${script}:${ts}`,
        source: 'unknown',
    };
}

export function isLifecycleCompleteEvent(channel: string, type: string): boolean {
    const ch = channel.toLowerCase();
    const t = type.toLowerCase();
    const isLifecycle =
        ch === 'agents:lifecycle' || ch.endsWith(':lifecycle') || ch === 'lifecycle';
    return isLifecycle && (t === 'disconnect' || t === 'destroy');
}

function stableEventKey(ts: number, channel: string, type: string, message: unknown): string {
    let hash = 0;
    const raw = JSON.stringify(message ?? null);
    for (let i = 0; i < raw.length; i += 1) {
        hash = (hash * 31 + raw.charCodeAt(i)) | 0;
    }
    return `${ts}:${channel}:${type}:${(hash >>> 0).toString(16)}`;
}

export function sanitizeAgentDiagnosticMessage(message: unknown): Record<string, unknown> {
    const rec = asRecord(message);
    if (!rec) {
        return { value: message == null ? null : String(message).slice(0, 500) };
    }
    return sanitizeForLog(rec) as Record<string, unknown>;
}

export function normalizeAgentDiagnosticEvent(
    channel: string,
    message: unknown,
    timestamp?: number,
): NormalizedAgentDiagnosticEvent {
    const msg = asRecord(message) ?? { value: message };
    const type = asString(msg.type) ?? 'unknown';
    const ts =
        typeof timestamp === 'number' && Number.isFinite(timestamp)
            ? timestamp
            : typeof msg.timestamp === 'number'
              ? msg.timestamp
              : Date.now();
    const sanitized = sanitizeAgentDiagnosticMessage(message);
    return {
        ts,
        channel: channel || 'agents:unknown',
        type,
        agent: asString(msg.agent) ?? undefined,
        name: asString(msg.name) ?? undefined,
        message: sanitized,
        eventKey: stableEventKey(ts, channel || 'agents:unknown', type, sanitized),
    };
}

export function buildAgentDiagnosticsDedupKey(worker: string, traceId: string): string {
    return `${INTAKE_KIND_AGENT_DIAGNOSTICS}:${worker}:${traceId}`;
}

export function mergeAgentDiagnosticEvents(
    existing: NormalizedAgentDiagnosticEvent[],
    incoming: NormalizedAgentDiagnosticEvent[],
): NormalizedAgentDiagnosticEvent[] {
    const byKey = new Map<string, NormalizedAgentDiagnosticEvent>();
    for (const e of existing) {
        byKey.set(e.eventKey, e);
    }
    for (const e of incoming) {
        byKey.set(e.eventKey, e);
    }
    return [...byKey.values()].sort((a, b) => a.ts - b.ts || a.eventKey.localeCompare(b.eventKey));
}

/** 从已存 Intake payload 还原事件列表 */
export function readAgentDiagnosticsEventsFromPayload(
    payload: Record<string, unknown>,
): NormalizedAgentDiagnosticEvent[] {
    if (!isIntakePayloadEnvelope(payload)) {
        return [];
    }
    for (const block of readPayloadBlocks(payload)) {
        if (block.type !== INTAKE_BLOCK_WORKER_IO_STREAM) {
            continue;
        }
        const data = block.data as { events?: unknown };
        if (!Array.isArray(data.events)) {
            continue;
        }
        const out: NormalizedAgentDiagnosticEvent[] = [];
        for (const item of data.events) {
            const rec = asRecord(item);
            if (!rec) {
                continue;
            }
            const ts = typeof rec.ts === 'number' ? rec.ts : 0;
            const channel = asString(rec.channel) ?? 'agents:unknown';
            const type = asString(rec.type) ?? 'unknown';
            const message = asRecord(rec.message) ?? {};
            const eventKey = asString(rec.eventKey) ?? stableEventKey(ts, channel, type, message);
            out.push({
                ts,
                channel,
                type,
                agent: asString(rec.agent) ?? undefined,
                name: asString(rec.name) ?? undefined,
                message,
                eventKey,
            });
        }
        return out;
    }
    return [];
}

export function readAgentDiagnosticsCompleteFromPayload(payload: Record<string, unknown>): {
    complete: boolean;
    completedAt?: string;
} {
    const complete = Boolean(readPayloadIndex(payload, 'complete'));
    const completedAt = asString(readPayloadIndex(payload, 'completedAt')) ?? undefined;
    return { complete, completedAt };
}

/**
 * 从一次 Tail batch item 抽出按 traceId 分组的规范化事件。
 */
export function groupTailItemDiagnostics(
    item: AgentDiagnosticsTailItem,
): Map<
    string,
    { conversationId?: string; events: NormalizedAgentDiagnosticEvent[]; complete: boolean }
> {
    const groups = new Map<
        string,
        { conversationId?: string; events: NormalizedAgentDiagnosticEvent[]; complete: boolean }
    >();
    const msgs = item.diagnosticsChannelEvents ?? [];
    for (const raw of msgs) {
        const channel = asString(raw.channel) ?? 'agents:unknown';
        const resolved = resolveAgentDiagnosticsTraceId({
            message: raw.message,
            tailTraceId: item.traceId,
            scriptName: item.scriptName,
            eventTimestamp: item.eventTimestamp ?? raw.timestamp,
        });
        const normalized = normalizeAgentDiagnosticEvent(channel, raw.message, raw.timestamp);
        const prev = groups.get(resolved.traceId) ?? {
            conversationId: resolved.conversationId,
            events: [],
            complete: false,
        };
        prev.events.push(normalized);
        if (resolved.conversationId && !prev.conversationId) {
            prev.conversationId = resolved.conversationId;
        }
        if (isLifecycleCompleteEvent(channel, normalized.type)) {
            prev.complete = true;
        }
        groups.set(resolved.traceId, prev);
    }
    return groups;
}

export async function buildAgentDiagnosticsStreamBlocks(
    env: QualityArtifactEnv,
    input: {
        worker: string;
        traceId: string;
        events: NormalizedAgentDiagnosticEvent[];
    },
): Promise<{ blocks: IntakeEvidenceBlock[]; truncated: boolean; eventCount: number }> {
    const events = input.events;
    const eventCount = events.length;
    const eventsJson = JSON.stringify(events);
    if (eventsJson.length <= AGENT_DIAGNOSTICS_INLINE_MAX_BYTES) {
        return {
            blocks: [
                {
                    id: 'agent-diagnostics-stream',
                    type: INTAKE_BLOCK_WORKER_IO_STREAM,
                    title: 'Agent diagnostics 事件流',
                    data: { events, eventCount },
                },
            ],
            truncated: false,
            eventCount,
        };
    }

    const put = await putIntakeOverflowJson(env, {
        worker: input.worker,
        artifactType: 'cf.agents.diagnostics',
        storyId: input.traceId,
        filename: 'events.json',
        body: eventsJson,
    });
    const recent = events.slice(-AGENT_DIAGNOSTICS_RECENT_INLINE);
    if (put) {
        return {
            blocks: [
                {
                    id: 'agent-diagnostics-stream',
                    type: INTAKE_BLOCK_WORKER_IO_STREAM,
                    title: 'Agent diagnostics 事件流（R2 + 最近摘要）',
                    data: {
                        events: recent,
                        eventCount,
                        r2Key: put.r2Key,
                        truncated: true,
                    },
                    truncated: true,
                },
                buildAttachmentRefBlock(
                    'attach-agent-diagnostics',
                    [
                        {
                            filename: 'events.json',
                            r2Key: put.r2Key,
                            contentType: 'application/json',
                            sizeBytes: put.sizeBytes,
                        },
                    ],
                    { title: 'Agent diagnostics 全量' },
                ),
            ],
            truncated: false,
            eventCount,
        };
    }
    return {
        blocks: [
            {
                id: 'agent-diagnostics-stream',
                type: INTAKE_BLOCK_WORKER_IO_STREAM,
                title: 'Agent diagnostics 事件流（截断）',
                data: {
                    events: recent,
                    eventCount,
                    truncated: true,
                },
                truncated: true,
            },
        ],
        truncated: true,
        eventCount,
    };
}

export function buildAgentDiagnosticsIntakeEvent(input: {
    worker: string;
    traceId: string;
    conversationId?: string;
    complete: boolean;
    completedAt?: string;
    eventCount: number;
    lastEventAt?: number;
    payloadEnvelope: IntakePayloadEnvelope;
    producer?: string;
    primaryRepo?: string;
    severity?: IntakeSeverity;
    occurredAt?: string;
    links?: IntakeLink[];
}): IntakeEvent {
    const completeLabel = input.complete ? '已结束可评审' : '进行中';
    const title =
        `Agent diagnostics ${input.worker} · ${input.traceId.slice(0, 24)}${input.traceId.length > 24 ? '…' : ''}`.slice(
            0,
            120,
        );
    const summary =
        `${completeLabel} · events=${input.eventCount}` +
        (input.conversationId ? ` · conversationId=${input.conversationId}` : '');
    return {
        schemaVersion: 1,
        kind: INTAKE_KIND_AGENT_DIAGNOSTICS,
        dedupKey: buildAgentDiagnosticsDedupKey(input.worker, input.traceId),
        source: {
            producer: input.producer ?? 'sch1',
            worker: input.worker,
            repo: input.primaryRepo,
        },
        title,
        summary: summary.slice(0, 500),
        severity: input.severity ?? 'info',
        occurredAt: input.occurredAt ?? shanghaiIsoString(),
        payload: input.payloadEnvelope as unknown as Record<string, unknown>,
        links: input.links,
    };
}

/**
 * 合并已有 payload + 新事件，组装完整 IntakeEvent（不抛；R2 缺失则截断）。
 */
export async function assembleAgentDiagnosticsIntake(
    env: QualityArtifactEnv,
    input: {
        worker: string;
        traceId: string;
        conversationId?: string;
        incomingEvents: NormalizedAgentDiagnosticEvent[];
        existingPayload?: Record<string, unknown> | null;
        markComplete?: boolean;
        primaryRepo?: string;
        producer?: string;
        agentName?: string;
        agentId?: string;
    },
): Promise<IntakeEvent> {
    const existingEvents = input.existingPayload
        ? readAgentDiagnosticsEventsFromPayload(input.existingPayload)
        : [];
    const prior = input.existingPayload
        ? readAgentDiagnosticsCompleteFromPayload(input.existingPayload)
        : { complete: false };
    const events = mergeAgentDiagnosticEvents(existingEvents, input.incomingEvents);
    const complete = Boolean(input.markComplete || prior.complete);
    const completedAt = complete
        ? (prior.completedAt ??
          (input.markComplete ? shanghaiIsoString() : undefined) ??
          shanghaiIsoString())
        : undefined;

    const lastEventAt = events.length > 0 ? events[events.length - 1].ts : undefined;
    const stream = await buildAgentDiagnosticsStreamBlocks(env, {
        worker: input.worker,
        traceId: input.traceId,
        events,
    });

    const conversationId =
        input.conversationId ??
        asString(readPayloadIndex(input.existingPayload ?? {}, 'conversationId')) ??
        undefined;

    const kvItems: Array<{ key: string; value: string }> = [
        { key: 'worker', value: input.worker },
        { key: 'storyId', value: input.traceId },
        { key: 'eventCount', value: String(stream.eventCount) },
        { key: 'complete', value: complete ? 'true' : 'false' },
    ];
    if (conversationId) {
        kvItems.push({ key: 'conversationId', value: conversationId });
    }
    if (completedAt) {
        kvItems.push({ key: 'completedAt', value: completedAt });
    }
    if (lastEventAt != null) {
        kvItems.push({ key: 'lastEventAt', value: String(lastEventAt) });
    }

    const blocks: IntakeEvidenceBlock[] = [
        buildKeyValueBlock('kv-agent-diagnostics', kvItems, { title: 'Agent diagnostics 摘要' }),
        ...stream.blocks,
    ];

    if (conversationId) {
        blocks.push({
            id: 'cf-agents-ref',
            type: INTAKE_BLOCK_CF_AGENTS_REF,
            title: 'CF Agents',
            data: {
                agentName: input.agentName ?? input.worker,
                agentId: input.agentId ?? input.worker,
                conversationId,
                dashboardUrl: buildCfAgentsDashboardUrl({
                    agentId: input.agentId ?? input.worker,
                    conversationId,
                }),
            },
        });
    }

    const index: Record<string, IntakePayloadIndexValue> = {
        storyId: input.traceId,
        worker: input.worker,
        eventCount: stream.eventCount,
        complete,
        ...(conversationId ? { conversationId } : {}),
        ...(completedAt ? { completedAt } : {}),
        ...(lastEventAt != null ? { lastEventAt } : {}),
        ...(input.primaryRepo ? { primaryRepo: input.primaryRepo } : {}),
    };

    const envelope = buildIntakePayloadEnvelope({
        index,
        blocks,
        enrich: {
            fetchedAt: shanghaiIsoString(),
            sources: ['cf.agents.diagnostics'],
            purpose: 'agent_diagnostics_story',
            truncated: stream.truncated || undefined,
        },
    });

    return buildAgentDiagnosticsIntakeEvent({
        worker: input.worker,
        traceId: input.traceId,
        conversationId,
        complete,
        completedAt,
        eventCount: stream.eventCount,
        lastEventAt,
        payloadEnvelope: envelope,
        producer: input.producer,
        primaryRepo: input.primaryRepo,
    });
}
