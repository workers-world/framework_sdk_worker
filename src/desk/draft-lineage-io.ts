/**
 * Draft lineage：WorkerIoEnvelope（wwcategory=lifecycle）+ audit-log 双写 helper。
 */
import { type MaintenanceLogEntry, writeMaintenanceLogAsync } from '../audit-log/client.js';
import {
    createWorkerIoEnvelope,
    encodeWorkerIoEnvelope,
    type WorkerIoEnvelope,
    type WorkerIoError,
} from '../io.js';
import type { SecretLike } from '../secrets/resolve.js';
import {
    formatTraceparent,
    formatTracestate,
    isSpanId,
    isTraceId,
    mintSpanId,
} from '../trace-id.js';

export const STREAM_DRAFT_LINEAGE = 'workers-world.draft_lineage' as const;

export type DraftLineageAction =
    | 'batch.started'
    | 'signal.buffered'
    | 'sector.expanded'
    | 'rule.evaluated'
    | 'fund.resolved'
    | 'llm.generated'
    | 'draft.inserted'
    | 'status.patched'
    | 'eval.outcome'
    | 'qa.answered'
    | 'intake.exported';

export type DraftLineageCfAgents = {
    agentName: string;
    agentId: string;
    conversationId: string;
};

export type DraftLineageData = {
    lineageId: string;
    draftId?: number;
    underlying?: string;
    step?: string;
    worker?: string;
    service?: string;
    inputs?: Record<string, unknown>;
    outputs?: Record<string, unknown>;
    agent?: {
        caller?: string;
        model?: string;
        ok?: boolean;
        error?: string;
    };
    cfAgents?: DraftLineageCfAgents;
    cfRequestId?: string;
    durationMs?: number;
};

export type CreateDraftLineageEnvelopeInput = {
    lineageId: string;
    eventId: string;
    source: string;
    action: DraftLineageAction;
    data: Omit<DraftLineageData, 'lineageId'>;
    wwsummary: string;
    terminal?: boolean;
    error?: WorkerIoError;
};

/** 步骤 span-id（W3C 16 hex）。从属于调用方持有的 lineage/trace，不把父 id 编进字符串。 */
export function newLineageEventId(): string {
    return mintSpanId();
}

function storyTraceparent(
    lineageId: string,
    eventId: string,
): {
    traceparent?: string;
    tracestate?: string;
} {
    if (!isTraceId(lineageId) || !isSpanId(eventId)) {
        return {};
    }
    return {
        traceparent: formatTraceparent(lineageId, eventId),
        tracestate: formatTracestate('desk'),
    };
}

export function createDraftLineageEnvelope(
    input: CreateDraftLineageEnvelopeInput,
): WorkerIoEnvelope<DraftLineageData> {
    return createWorkerIoEnvelope({
        id: `${input.lineageId}:${input.eventId}`,
        source: input.source,
        type: `workers-world.desk.draft.${input.action}`,
        wwstream: STREAM_DRAFT_LINEAGE,
        wwcategory: 'lifecycle',
        wwsummary: input.wwsummary,
        wwterminal: input.terminal ? true : undefined,
        wwerror: input.error,
        ...storyTraceparent(input.lineageId, input.eventId),
        data: { ...input.data, lineageId: input.lineageId },
    });
}

export type AppendDraftLineageInput = Omit<CreateDraftLineageEnvelopeInput, 'eventId'> & {
    eventId?: string;
    /** audit-log actor；缺省 system */
    actor?: string;
    /** audit-log target，缺省 draft:{draftId} 或 underlying:{symbol} */
    target?: string;
    /** audit-log action，缺省 draft.lineage.{action} */
    auditAction?: string;
};

export type AppendDraftLineageDeps = {
    auditLog?: Fetcher;
    auditToken?: SecretLike;
    ctx?: Pick<ExecutionContext, 'waitUntil'>;
    worker: string;
    service: string;
    /** D1 等本地低延迟时间线；fail-open */
    persistLocal?: (envelope: WorkerIoEnvelope<DraftLineageData>) => Promise<void>;
};

function defaultTarget(data: DraftLineageData): string {
    if (data.draftId != null) {
        return `draft:${data.draftId}`;
    }
    if (data.underlying) {
        return `underlying:${data.underlying}`;
    }
    return `lineage:${data.lineageId}`;
}

/** 构造 envelope 并双写 audit-log + 可选本地表（fail-open） */
export async function appendDraftLineage(
    deps: AppendDraftLineageDeps,
    input: AppendDraftLineageInput,
): Promise<WorkerIoEnvelope<DraftLineageData>> {
    const eventId = input.eventId ?? newLineageEventId();
    const envelope = createDraftLineageEnvelope({ ...input, eventId });
    const encoded = encodeWorkerIoEnvelope(envelope);
    const data = envelope.data as DraftLineageData;

    if (deps.persistLocal) {
        try {
            await deps.persistLocal(envelope);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`appendDraftLineage persistLocal failed: ${msg}`);
        }
    }

    const entry: MaintenanceLogEntry = {
        ts: envelope.time,
        actor: input.actor ?? 'system',
        worker: deps.worker,
        service: deps.service,
        action: input.auditAction ?? `draft.lineage.${input.action}`,
        target: input.target ?? defaultTarget(data),
        tech: 'draft_lineage',
        traceId: input.lineageId,
        detail: encoded,
    };
    writeMaintenanceLogAsync(deps.auditLog, deps.auditToken, entry, deps.ctx);

    return envelope;
}

/** 多 signal 合并 context 时取主 lineage（最早 traceId） */
export function resolvePrimaryLineageId(traceIds: string[], fallback: string): string {
    const trimmed = traceIds.map((t) => t.trim()).filter(Boolean);
    if (trimmed.length === 0) {
        return fallback;
    }
    return trimmed[0]!;
}
