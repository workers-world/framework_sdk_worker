/**
 * Intake payload 通用信封 v2：index（routing/摘要）+ blocks（可扩展证据）。
 * 新 enrich / 新 kind 只追加 block，不修改既有 block type 的 data 形状。
 */
import type { QualityClusterAuditLogRef, QualityClusterCaseRef } from './builders.js';

export const INTAKE_PAYLOAD_VERSION = 2 as const;

export type IntakePayloadIndexValue = string | number | boolean | string[];

export interface IntakeBlockRef {
    rel: 'dedupKey' | 'traceId' | 'clusterId' | 'attachment' | 'r2Key' | 'emailDedup' | 'link';
    value: string;
    href?: string;
    label?: string;
}

export interface IntakeEnrichMeta {
    fetchedAt: string;
    sources?: string[];
    truncated?: boolean;
    purpose?: string;
}

/** 单块证据；`type` 为开放 registry，未知 type 仍 JSON 落库 */
export interface IntakeEvidenceBlock {
    id: string;
    type: string;
    title?: string;
    refs?: IntakeBlockRef[];
    data: unknown;
    /** Issue / UI 可直接拼接的 markdown（可选预渲染） */
    markdown?: string;
    truncated?: boolean;
}

export interface IntakePayloadEnvelope {
    payloadVersion: typeof INTAKE_PAYLOAD_VERSION;
    /** routing 与列表展示用标量索引（如 primaryRepo、repos、digestDate） */
    index: Record<string, IntakePayloadIndexValue>;
    blocks: IntakeEvidenceBlock[];
    enrich?: IntakeEnrichMeta;
}

/** 已知 block type（扩展时在 registry 文档登记；运行时未知 type 仍可存储） */
export const INTAKE_BLOCK_AUDIT_LOG_CHAIN = 'intake.audit_log_chain';
export const INTAKE_BLOCK_CASE_LIST = 'intake.case_list';
export const INTAKE_BLOCK_MARKDOWN = 'intake.markdown';
export const INTAKE_BLOCK_ATTACHMENT_REF = 'intake.attachment_ref';
export const INTAKE_BLOCK_KEY_VALUE = 'intake.key_value';
export const INTAKE_BLOCK_DIAGNOSIS_LIST = 'intake.diagnosis_list';

export interface AuditLogChainBlockData {
    logs: QualityClusterAuditLogRef[];
}

export interface CaseListBlockData {
    cases: QualityClusterCaseRef[];
}

export interface MarkdownBlockData {
    text: string;
}

export interface AttachmentRefItem {
    filename: string;
    contentType?: string;
    sizeBytes?: number;
    note?: string;
}

export interface AttachmentRefBlockData {
    items: AttachmentRefItem[];
}

export interface KeyValueBlockData {
    items: Array<{ key: string; value: string }>;
}

export interface DiagnosisListBlockData {
    items: Array<{
        dedupKey: string;
        service?: string;
        isBug?: boolean;
        rootCause?: string;
        recommendation?: string;
        suspectedFiles?: string[];
        fixUrl?: string;
    }>;
}

export function isIntakePayloadEnvelope(payload: unknown): payload is IntakePayloadEnvelope {
    if (!payload || typeof payload !== 'object') {
        return false;
    }
    const record = payload as Record<string, unknown>;
    return record.payloadVersion === INTAKE_PAYLOAD_VERSION && Array.isArray(record.blocks);
}

/** v2 index 优先；v1 扁平 payload 回退到顶层字段 */
export function readPayloadIndex(
    payload: Record<string, unknown>,
    key: string,
): IntakePayloadIndexValue | undefined {
    if (isIntakePayloadEnvelope(payload)) {
        return payload.index[key];
    }
    const v = payload[key];
    if (v == null) {
        return undefined;
    }
    if (
        typeof v === 'string' ||
        typeof v === 'number' ||
        typeof v === 'boolean' ||
        (Array.isArray(v) && v.every((item) => typeof item === 'string'))
    ) {
        return v as IntakePayloadIndexValue;
    }
    return undefined;
}

export function readPayloadBlocks(payload: Record<string, unknown>): IntakeEvidenceBlock[] {
    if (isIntakePayloadEnvelope(payload)) {
        return payload.blocks;
    }
    return [];
}

export function readPayloadEnrich(payload: Record<string, unknown>): IntakeEnrichMeta | undefined {
    if (isIntakePayloadEnvelope(payload)) {
        return payload.enrich;
    }
    const legacy = payload.auditEnrich;
    if (legacy && typeof legacy === 'object') {
        return legacy as IntakeEnrichMeta;
    }
    return undefined;
}

export function buildIntakePayloadEnvelope(input: {
    index: Record<string, IntakePayloadIndexValue>;
    blocks: IntakeEvidenceBlock[];
    enrich?: IntakeEnrichMeta;
}): IntakePayloadEnvelope {
    return {
        payloadVersion: INTAKE_PAYLOAD_VERSION,
        index: input.index,
        blocks: input.blocks,
        ...(input.enrich ? { enrich: input.enrich } : {}),
    };
}

export function buildAuditLogChainBlock(
    id: string,
    dedupKey: string,
    logs: QualityClusterAuditLogRef[],
    options?: { title?: string; truncated?: boolean },
): IntakeEvidenceBlock {
    return {
        id,
        type: INTAKE_BLOCK_AUDIT_LOG_CHAIN,
        title: options?.title ?? 'Agent 链路日志',
        refs: [{ rel: 'dedupKey', value: dedupKey }],
        data: { logs } satisfies AuditLogChainBlockData,
        truncated: options?.truncated,
    };
}

export function buildCaseListBlock(
    id: string,
    cases: QualityClusterCaseRef[],
    options?: { title?: string },
): IntakeEvidenceBlock {
    return {
        id,
        type: INTAKE_BLOCK_CASE_LIST,
        title: options?.title ?? 'Cases',
        data: { cases } satisfies CaseListBlockData,
    };
}

export function buildMarkdownBlock(id: string, title: string, text: string): IntakeEvidenceBlock {
    const trimmed = text.trim();
    return {
        id,
        type: INTAKE_BLOCK_MARKDOWN,
        title,
        data: { text: trimmed } satisfies MarkdownBlockData,
        markdown: trimmed ? `### ${title}\n\n${trimmed}` : undefined,
    };
}

export function buildAttachmentRefBlock(
    id: string,
    items: AttachmentRefItem[],
    options?: { title?: string },
): IntakeEvidenceBlock {
    const title = options?.title ?? 'Attachments';
    const lines = items.map((item) => {
        const meta = [
            item.contentType,
            item.sizeBytes != null ? `${item.sizeBytes}B` : null,
            item.note,
        ]
            .filter(Boolean)
            .join(' · ');
        return meta ? `- \`${item.filename}\` (${meta})` : `- \`${item.filename}\``;
    });
    return {
        id,
        type: INTAKE_BLOCK_ATTACHMENT_REF,
        title,
        data: { items } satisfies AttachmentRefBlockData,
        markdown: lines.length > 0 ? `### ${title}\n\n${lines.join('\n')}` : undefined,
    };
}

export function buildKeyValueBlock(
    id: string,
    items: Array<{ key: string; value: string }>,
    options?: { title?: string },
): IntakeEvidenceBlock {
    const title = options?.title ?? 'Details';
    const lines = items.map((item) => `- **${item.key}**: ${item.value}`);
    return {
        id,
        type: INTAKE_BLOCK_KEY_VALUE,
        title,
        data: { items } satisfies KeyValueBlockData,
        markdown: lines.length > 0 ? `### ${title}\n\n${lines.join('\n')}` : undefined,
    };
}

export function buildDiagnosisListBlock(
    id: string,
    items: DiagnosisListBlockData['items'],
    options?: { title?: string },
): IntakeEvidenceBlock {
    const title = options?.title ?? 'Diagnosis';
    const lines: string[] = [];
    for (const item of items) {
        lines.push(`#### \`${item.dedupKey}\``, '');
        if (item.service) {
            lines.push(`- service: ${item.service}`);
        }
        if (item.isBug != null) {
            lines.push(`- isBug: ${String(item.isBug)}`);
        }
        if (item.rootCause) {
            lines.push(`- rootCause: ${item.rootCause}`);
        }
        if (item.recommendation) {
            lines.push(`- recommendation: ${item.recommendation}`);
        }
        if (item.suspectedFiles?.length) {
            lines.push(`- suspectedFiles: ${item.suspectedFiles.join(', ')}`);
        }
        if (item.fixUrl) {
            lines.push(`- fixUrl: ${item.fixUrl}`);
        }
        lines.push('');
    }
    return {
        id,
        type: INTAKE_BLOCK_DIAGNOSIS_LIST,
        title,
        data: { items } satisfies DiagnosisListBlockData,
        markdown: lines.length > 0 ? `### ${title}\n\n${lines.join('\n')}` : undefined,
    };
}

function auditLogChainToMarkdown(block: IntakeEvidenceBlock): string | null {
    const data = block.data as AuditLogChainBlockData | undefined;
    const logs = data?.logs;
    if (!Array.isArray(logs) || logs.length === 0) {
        return null;
    }
    const dedup = block.refs?.find((r) => r.rel === 'dedupKey')?.value ?? '—';
    const lines = [`#### \`${dedup}\``, ''];
    for (const log of logs) {
        lines.push(`- **${log.action}** @ ${log.ts}`);
        const d = log.parsed?.diagnosis;
        if (d?.rootCause) {
            lines.push(`  - rootCause: ${d.rootCause}`);
        }
        if (d?.recommendation) {
            lines.push(`  - recommendation: ${d.recommendation}`);
        }
        if (d?.suspectedFiles?.length) {
            lines.push(`  - suspectedFiles: ${d.suspectedFiles.join(', ')}`);
        }
        if (d?.isBug != null) {
            lines.push(`  - isBug: ${String(d.isBug)}`);
        }
        if (d?.suspectedLayer) {
            lines.push(`  - suspectedLayer: ${d.suspectedLayer}`);
        }
        const cap = log.parsed?.capture;
        if (cap?.timelineCount != null) {
            lines.push(`  - timeline: ${String(cap.timelineCount)}`);
        }
        if (cap?.logsCaptured != null) {
            lines.push(`  - logsCaptured: ${String(cap.logsCaptured)}`);
        }
        if (cap?.captureError) {
            lines.push(`  - captureError: ${cap.captureError}`);
        }
        const fix = log.parsed?.fix;
        if (fix?.status) {
            lines.push(`  - status: ${fix.status}`);
        }
        if (fix?.prUrl) {
            lines.push(`  - prUrl: ${fix.prUrl}`);
        }
    }
    lines.push('');
    const title = block.title ?? 'Agent 链路日志';
    return `### ${title}\n\n${lines.join('\n')}`;
}

function caseListToMarkdown(block: IntakeEvidenceBlock): string | null {
    const data = block.data as CaseListBlockData | undefined;
    const cases = data?.cases;
    if (!Array.isArray(cases) || cases.length === 0) {
        return null;
    }
    const lines = [`### ${block.title ?? 'Cases'}`, ''];
    for (const c of cases.slice(0, 30)) {
        lines.push(
            `- \`${c.dedupKey}\` worker=${c.worker ?? '—'} rule=${c.ruleId ?? c.kind ?? '—'}`,
        );
    }
    lines.push('');
    for (const c of cases.slice(0, 30)) {
        if (!c.auditLogs?.length) {
            continue;
        }
        lines.push(
            auditLogChainToMarkdown(
                buildAuditLogChainBlock(`chain-${c.dedupKey}`, c.dedupKey, c.auditLogs),
            ) ?? '',
        );
    }
    return lines.filter(Boolean).join('\n');
}

/** 将单 block 渲染为 Issue markdown；未知 type 用预置 markdown 或 JSON 兜底 */
export function formatIntakeBlockMarkdown(block: IntakeEvidenceBlock): string | null {
    if (block.markdown?.trim()) {
        return block.markdown.trim();
    }
    if (block.type === INTAKE_BLOCK_AUDIT_LOG_CHAIN) {
        return auditLogChainToMarkdown(block);
    }
    if (block.type === INTAKE_BLOCK_CASE_LIST) {
        return caseListToMarkdown(block);
    }
    if (block.type === INTAKE_BLOCK_MARKDOWN) {
        const text = (block.data as MarkdownBlockData | undefined)?.text?.trim();
        if (!text) {
            return null;
        }
        return block.title ? `### ${block.title}\n\n${text}` : text;
    }
    if (block.type === INTAKE_BLOCK_ATTACHMENT_REF) {
        return (
            buildAttachmentRefBlock(block.id, (block.data as AttachmentRefBlockData).items ?? [], {
                title: block.title,
            }).markdown ?? null
        );
    }
    if (block.type === INTAKE_BLOCK_KEY_VALUE) {
        const items = (block.data as KeyValueBlockData | undefined)?.items ?? [];
        return buildKeyValueBlock(block.id, items, { title: block.title }).markdown ?? null;
    }
    if (block.type === INTAKE_BLOCK_DIAGNOSIS_LIST) {
        const items = (block.data as DiagnosisListBlockData | undefined)?.items ?? [];
        return buildDiagnosisListBlock(block.id, items, { title: block.title }).markdown ?? null;
    }
    try {
        return `### ${block.title ?? block.type}\n\n\`\`\`json\n${JSON.stringify(block.data, null, 2)}\n\`\`\``;
    } catch {
        return null;
    }
}

/** 按 blocks 顺序拼接 Issue 正文小节 */
export function formatIntakeBlocksMarkdown(blocks: IntakeEvidenceBlock[]): string {
    const parts: string[] = [];
    for (const block of blocks) {
        const section = formatIntakeBlockMarkdown(block);
        if (section) {
            parts.push(section);
        }
    }
    return parts.join('\n\n');
}
