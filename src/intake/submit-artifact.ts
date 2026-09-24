/**
 * 业务产物一键质量入库：lite（失败）/ dump（人手导出观测包）。
 * 组装 v2 envelope + R2 溢出 + audit-log / envelopes enrich；不抛。
 */
import { queryMaintenanceLogsSince } from '../audit-log/client.js';
import type { WorkerIoEnvelope } from '../io/envelope.js';
import { buildCfAgentsDashboardUrl } from '../observability/cf-agents.js';
import type { SecretLike } from '../secrets/resolve.js';
import { shanghaiIsoString } from '../time.js';
import { buildQualityArtifactIntake } from './builders.js';
import {
    INTAKE_KIND_DESK_DRAFT_QUALITY,
    INTAKE_KIND_DESK_OBS_DUMP,
    INTAKE_KIND_QUALITY_ARTIFACT,
} from './kinds.js';
import {
    buildArtifactSnapshotBlock,
    buildAttachmentRefBlock,
    buildIntakePayloadEnvelope,
    buildKeyValueBlock,
    buildMarkdownBlock,
    INTAKE_BLOCK_AUDIT_LOG_CHAIN,
    INTAKE_BLOCK_CF_AGENTS_REF,
    INTAKE_BLOCK_DRAFT_SNAPSHOT,
    INTAKE_BLOCK_OBSERVABILITY_REF,
    INTAKE_BLOCK_WORKER_IO_STREAM,
    type IntakeEvidenceBlock,
    type IntakePayloadEnvelope,
    type IntakePayloadIndexValue,
} from './payload-envelope.js';
import { type IntakeEnv, submitIntakeEvent } from './submit.js';
import type { IntakeEvent, IntakeLink, IntakeSeverity, SubmitIntakeResult } from './types.js';

/** Intake 内联 envelope JSON 上限；超出且有 R2 时落桶 */
export const QUALITY_ARTIFACT_INLINE_MAX_BYTES = 48_000;

/** lite 快照 JSON 上限（超出截断并标 truncated） */
const LITE_SNAPSHOT_MAX_BYTES = 12_000;

export type QualityArtifactMode = 'lite' | 'dump';

export interface QualityArtifactEnv extends IntakeEnv {
    SVC_AUDIT_LOG?: Fetcher;
    AUDIT_LOG_AUTH_TOKEN?: SecretLike;
    /** 与 sch1 批准拉附件同桶（优先） */
    R2_QUALITY_CAPTURE?: R2Bucket;
    /** 生产者自有桶兜底（如 desk R2_INTAKE_DIGEST） */
    R2_INTAKE_DIGEST?: R2Bucket;
}

export interface SubmitQualityArtifactInput {
    worker: string;
    artifactType: string;
    mode: QualityArtifactMode;
    /** W3C traceId / lineageId / 质量 dedupKey */
    storyId: string;
    title?: string;
    summary?: string;
    severity?: IntakeSeverity;
    /** lite 失败假说（mode=lite 建议必填） */
    reason?: string;
    detail?: string;
    snapshot?: Record<string, unknown>;
    envelopes?: WorkerIoEnvelope[];
    primaryRepo?: string;
    producer?: string;
    /**
     * 存量兼容：desk.draft_quality / desk.obs_dump。
     * 设置后沿用该 kind 的 dedup 公式，不改写历史 UNIQUE(dedup_key)。
     */
    kindOverride?: string;
    dedupKey?: string;
    /** 并入 envelope.index（如 lineageId、draftId） */
    indexExtra?: Record<string, IntakePayloadIndexValue>;
    links?: IntakeLink[];
    enrichPurpose?: string;
    enrichSources?: string[];
    /** CF Agents block 默认 agentName */
    agentName?: string;
    /** 额外证据块（插在标准块之后、检测说明之前） */
    extraBlocks?: IntakeEvidenceBlock[];
    ctx?: Pick<ExecutionContext, 'waitUntil'>;
}

export interface SubmitQualityArtifactResult extends SubmitIntakeResult {
    dedupKey?: string;
    kind?: string;
}

function resolveR2Bucket(env: QualityArtifactEnv): R2Bucket | undefined {
    return env.R2_QUALITY_CAPTURE ?? env.R2_INTAKE_DIGEST;
}

function truncateSnapshot(
    snapshot: Record<string, unknown>,
    mode: QualityArtifactMode,
): { snapshot: Record<string, unknown>; truncated: boolean } {
    const json = JSON.stringify(snapshot);
    if (mode === 'dump' || json.length <= LITE_SNAPSHOT_MAX_BYTES) {
        return { snapshot, truncated: false };
    }
    const keys = Object.keys(snapshot);
    const slim: Record<string, unknown> = { _truncated: true, _originalBytes: json.length };
    for (const key of keys.slice(0, 12)) {
        const value = snapshot[key];
        if (typeof value === 'string' && value.length > 500) {
            slim[key] = `${value.slice(0, 500)}…`;
        } else if (value != null && typeof value === 'object') {
            const nested = JSON.stringify(value);
            slim[key] = nested.length > 800 ? `${nested.slice(0, 800)}…` : value;
        } else {
            slim[key] = value;
        }
    }
    return { snapshot: slim, truncated: true };
}

/** 大 JSON 落 R2；返回 r2Key 或 null（无桶） */
export async function putIntakeOverflowJson(
    env: QualityArtifactEnv,
    input: {
        worker: string;
        artifactType: string;
        storyId: string;
        filename: string;
        body: string;
        contentType?: string;
    },
): Promise<{ r2Key: string; sizeBytes: number } | null> {
    const bucket = resolveR2Bucket(env);
    if (!bucket) {
        return null;
    }
    const r2Key = `intake-digest/${input.worker}/${input.artifactType}/${input.storyId}/${input.filename}`;
    await bucket.put(r2Key, input.body, {
        httpMetadata: { contentType: input.contentType ?? 'application/json' },
    });
    return { r2Key, sizeBytes: input.body.length };
}

export async function buildWorkerIoStreamBlocks(
    env: QualityArtifactEnv,
    input: {
        worker: string;
        artifactType: string;
        storyId: string;
        envelopes: WorkerIoEnvelope[];
        title?: string;
    },
): Promise<{ blocks: IntakeEvidenceBlock[]; truncated: boolean }> {
    const envelopes = input.envelopes;
    if (envelopes.length === 0) {
        return { blocks: [], truncated: false };
    }
    const envelopesJson = JSON.stringify(envelopes);
    const title = input.title ?? 'Worker IO stream';
    if (envelopesJson.length > QUALITY_ARTIFACT_INLINE_MAX_BYTES) {
        const put = await putIntakeOverflowJson(env, {
            worker: input.worker,
            artifactType: input.artifactType,
            storyId: input.storyId,
            filename: 'envelopes.json',
            body: envelopesJson,
        });
        if (put) {
            return {
                blocks: [
                    {
                        id: 'worker-io-stream',
                        type: INTAKE_BLOCK_WORKER_IO_STREAM,
                        title: `${title}（R2）`,
                        data: {
                            r2Key: put.r2Key,
                            envelopeCount: envelopes.length,
                        },
                    },
                    buildAttachmentRefBlock(
                        'attach-envelopes',
                        [
                            {
                                filename: 'envelopes.json',
                                r2Key: put.r2Key,
                                contentType: 'application/json',
                                sizeBytes: put.sizeBytes,
                            },
                        ],
                        { title: 'Lineage envelopes' },
                    ),
                ],
                truncated: false,
            };
        }
        const keep = Math.min(8, envelopes.length);
        return {
            blocks: [
                {
                    id: 'worker-io-stream',
                    type: INTAKE_BLOCK_WORKER_IO_STREAM,
                    title: `${title}（截断）`,
                    data: {
                        envelopes: envelopes.slice(0, keep),
                        envelopeCount: envelopes.length,
                        truncated: true,
                    },
                    truncated: true,
                },
            ],
            truncated: true,
        };
    }
    return {
        blocks: [
            {
                id: 'worker-io-stream',
                type: INTAKE_BLOCK_WORKER_IO_STREAM,
                title,
                data: { envelopes },
            },
        ],
        truncated: false,
    };
}

export function appendObsAndAgentBlocks(
    blocks: IntakeEvidenceBlock[],
    envelopes: WorkerIoEnvelope[],
    options?: { agentName?: string },
): void {
    const agentName = options?.agentName ?? 'market-qa-agent';
    const cfAgentsRefs = envelopes
        .map(
            (e) =>
                (e.data as { cfAgents?: { agentId: string; conversationId: string } } | undefined)
                    ?.cfAgents,
        )
        .filter(Boolean);
    const obsRefs = envelopes
        .map((e) => (e.data as { cfRequestId?: string } | undefined)?.cfRequestId)
        .filter(Boolean)
        .map((id) => ({ cfRequestId: id as string }));

    for (const [i, ref] of cfAgentsRefs.entries()) {
        if (!ref) {
            continue;
        }
        blocks.push({
            id: `cf-agents-${i}`,
            type: INTAKE_BLOCK_CF_AGENTS_REF,
            title: 'CF Agents',
            data: {
                agentName,
                agentId: ref.agentId,
                conversationId: ref.conversationId,
                dashboardUrl: buildCfAgentsDashboardUrl({
                    agentId: ref.agentId,
                    conversationId: ref.conversationId,
                }),
            },
        });
    }
    for (const [i, ref] of obsRefs.entries()) {
        blocks.push({
            id: `obs-ref-${i}`,
            type: INTAKE_BLOCK_OBSERVABILITY_REF,
            title: 'Workers trace',
            data: ref,
        });
    }
}

export async function appendAuditChainBlock(
    env: QualityArtifactEnv,
    storyId: string,
    blocks: IntakeEvidenceBlock[],
): Promise<boolean> {
    if (!env.SVC_AUDIT_LOG) {
        return false;
    }
    const audit = await queryMaintenanceLogsSince(env.SVC_AUDIT_LOG, env.AUDIT_LOG_AUTH_TOKEN, {
        traceId: storyId,
        order: 'asc',
    });
    if (!audit.ok || audit.rows.length === 0) {
        return false;
    }
    blocks.push({
        id: 'audit-chain',
        type: INTAKE_BLOCK_AUDIT_LOG_CHAIN,
        title: 'audit-log 链路',
        data: {
            logs: audit.rows.map((r) => ({
                id: r.id,
                ts: r.ts,
                action: r.action,
                service: r.service,
                target: r.target,
                traceId: r.traceId,
                detailPreview: r.detail?.slice(0, 500),
            })),
        },
    });
    return true;
}

function dumpInspectionMarkdown(input: {
    primaryRepo?: string;
    artifactType: string;
    storyId: string;
}): string {
    const repo = input.primaryRepo?.trim() || '（index.primaryRepo）';
    return [
        `产物 \`${input.artifactType}\` · storyId=\`${input.storyId}\`。`,
        '',
        '请根据本 Issue 的 Index、产物快照、R2 附件与 audit-log 链路定位问题。',
        `- 仅修改仓库：\`${repo}\``,
        '- 开 PR 前在本 run 内执行：`npm ci && npm run check && npm test`（失败须先修）',
        '- 证据以信封 blocks / 附件为准；勿假设未附带的全量平台日志',
    ].join('\n');
}

async function assembleQualityArtifact(
    env: QualityArtifactEnv,
    input: SubmitQualityArtifactInput,
): Promise<{ event: IntakeEvent; truncated: boolean } | { error: string }> {
    const worker = input.worker.trim();
    const artifactType = input.artifactType.trim();
    const storyId = input.storyId.trim();
    if (!worker || !artifactType || !storyId) {
        return { error: 'worker, artifactType, storyId required' };
    }
    if (input.mode === 'lite' && !input.reason?.trim()) {
        return { error: 'reason required for mode=lite' };
    }

    const kind = input.kindOverride?.trim() || INTAKE_KIND_QUALITY_ARTIFACT;
    const sources = new Set<string>(input.enrichSources ?? []);
    let anyTruncated = false;

    const kvItems: Array<{ key: string; value: string }> = [
        { key: 'worker', value: worker },
        { key: 'artifactType', value: artifactType },
        { key: 'mode', value: input.mode },
        { key: 'storyId', value: storyId },
        ...(input.reason?.trim() ? [{ key: 'reason', value: input.reason.trim() }] : []),
        ...(input.detail?.trim() ? [{ key: 'detail', value: input.detail.trim() }] : []),
    ];
    const blocks: IntakeEvidenceBlock[] = [
        buildKeyValueBlock('kv-summary', kvItems, { title: '质量摘要' }),
    ];

    if (input.envelopes && input.envelopes.length > 0) {
        const stream = await buildWorkerIoStreamBlocks(env, {
            worker,
            artifactType,
            storyId,
            envelopes: input.envelopes,
        });
        blocks.push(...stream.blocks);
        if (stream.truncated) {
            anyTruncated = true;
        }
        sources.add('worker_io_envelopes');
    }

    if (input.snapshot && Object.keys(input.snapshot).length > 0) {
        const { snapshot, truncated } = truncateSnapshot(input.snapshot, input.mode);
        if (truncated) {
            anyTruncated = true;
        }
        blocks.push(
            buildArtifactSnapshotBlock('artifact-snapshot', snapshot, {
                artifactType,
                mode: input.mode,
                truncated,
            }),
        );
        const draft = snapshot.draft;
        if (draft && typeof draft === 'object') {
            blocks.push({
                id: 'draft-snapshot',
                type: INTAKE_BLOCK_DRAFT_SNAPSHOT,
                title: '草稿快照',
                data: { draft: draft as Record<string, unknown> },
                truncated,
            });
        }
    }

    if (await appendAuditChainBlock(env, storyId, blocks)) {
        sources.add('audit-log');
    }

    if (input.envelopes && input.envelopes.length > 0) {
        appendObsAndAgentBlocks(blocks, input.envelopes, { agentName: input.agentName });
    }

    if (input.extraBlocks?.length) {
        blocks.push(...input.extraBlocks);
    }

    if (input.mode === 'dump') {
        blocks.push(
            buildMarkdownBlock(
                'agent-inspect',
                'Agent 检测说明',
                dumpInspectionMarkdown({
                    primaryRepo: input.primaryRepo,
                    artifactType,
                    storyId,
                }),
            ),
        );
    }

    const purpose =
        input.enrichPurpose?.trim() ||
        (kind === INTAKE_KIND_DESK_OBS_DUMP
            ? 'desk_obs_dump'
            : kind === INTAKE_KIND_DESK_DRAFT_QUALITY
              ? 'desk_draft_quality'
              : `quality_artifact_${input.mode}`);

    const envelope: IntakePayloadEnvelope = buildIntakePayloadEnvelope({
        index: {
            artifactType,
            mode: input.mode,
            storyId,
            ...(input.primaryRepo ? { primaryRepo: input.primaryRepo } : {}),
            ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
            ...(input.detail?.trim() ? { detail: input.detail.trim() } : {}),
            ...(input.mode === 'dump' ? { purpose: 'full_dump' } : {}),
            ...(input.indexExtra ?? {}),
        },
        blocks,
        enrich: {
            fetchedAt: shanghaiIsoString(),
            purpose,
            sources: [...sources],
            ...(anyTruncated ? { truncated: true } : {}),
        },
    });

    const event = buildQualityArtifactIntake({
        worker,
        artifactType,
        mode: input.mode,
        storyId,
        reason: input.reason,
        primaryRepo: input.primaryRepo,
        producer: input.producer,
        title: input.title,
        summary: input.summary,
        payloadEnvelope: envelope,
        severity: input.severity,
        dedupKey: input.dedupKey,
        links: input.links,
        kindOverride: input.kindOverride,
    });

    return { event, truncated: anyTruncated };
}

/** 仅组装 event，不提交（单测 / 预览） */
export async function buildQualityArtifactEvent(
    env: QualityArtifactEnv,
    input: SubmitQualityArtifactInput,
): Promise<{ event: IntakeEvent; truncated: boolean } | { error: string }> {
    return assembleQualityArtifact(env, input);
}

/**
 * 组装并提交业务产物 Intake。
 * lite：失败假说 + 截断快照；dump：尽量完整 + 通用检测说明。
 */
export async function submitQualityArtifact(
    env: QualityArtifactEnv,
    input: SubmitQualityArtifactInput,
): Promise<SubmitQualityArtifactResult> {
    const assembled = await assembleQualityArtifact(env, input);
    if ('error' in assembled) {
        return { ok: false, error: assembled.error };
    }
    const result = await submitIntakeEvent(env, assembled.event);
    return {
        ...result,
        dedupKey: assembled.event.dedupKey,
        kind: assembled.event.kind,
    };
}

/** 热路径 fire-and-forget */
export function submitQualityArtifactAsync(
    env: QualityArtifactEnv,
    input: SubmitQualityArtifactInput,
): void {
    const promise = submitQualityArtifact(env, input).then((result) => {
        if (!result.ok) {
            console.warn(
                `[intake] quality artifact failed kind=${result.kind ?? input.kindOverride ?? INTAKE_KIND_QUALITY_ARTIFACT} storyId=${input.storyId} error=${result.error ?? 'unknown'}`,
            );
        }
    });
    if (input.ctx?.waitUntil) {
        input.ctx.waitUntil(promise);
        return;
    }
    void promise;
}
