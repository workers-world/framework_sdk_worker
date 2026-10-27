/**
 * 产物质量事件契约与 Hard Evaluator（跨 Worker 质量监管 Phase 0/1）。
 * 上游：email-rule / invest-rss / advisor / desk emit QualityIncident
 * 下游：orchestrator 聚类告警、QualityAuditPipeline 诊断
 * 不变量：pass=true 表示静默（预期降级）；pass=false 触发告警/工单
 */

import { ArticleFetchReason } from './article-fetch-reason.js';
import { SummaryDecisionBecause } from './summary-decision-because.js';

export type QualitySeverity = 'hard' | 'soft' | 'silent';

export interface QualityIncident {
    service: string;
    kind: string;
    because: string;
    clusterKey: string;
    dedupKey?: string;
    /** 当前 Worker invocation（emit / queue consumer 侧） */
    invocationId?: string;
    /** 邮件热路径 invocation（fetch / process-email 日志） */
    emailInvocationId?: string;
    url?: string;
    fingerprint?: string;
    ruleId?: string;
    fields: Record<string, string | number | boolean>;
    ts: string;
}

export interface QualityOpsRules {
    silentBecause: string[];
    alertDedupTtlSec: number;
    ticketDedupTtlSec: number;
    minClusterCount: number;
    maxIncidentsPerCluster: number;
    maxIncidentsPerDedupKey: number;
}

export const DEFAULT_QUALITY_OPS_RULES: QualityOpsRules = {
    silentBecause: [SummaryDecisionBecause.video_link.code, SummaryDecisionBecause.pdf_link.code],
    alertDedupTtlSec: 86_400,
    ticketDedupTtlSec: 86_400,
    minClusterCount: 1,
    maxIncidentsPerCluster: 20,
    maxIncidentsPerDedupKey: 30,
};

export interface QualityIncidentEval {
    /** true = 预期降级，不告警 */
    pass: boolean;
    severity: QualitySeverity;
    ruleId: string;
    feedback: string;
}

export interface QualityCluster {
    clusterKey: string;
    service: string;
    kind: string;
    because: string;
    count: number;
    severity: QualitySeverity;
    sampleUrl?: string;
    sampleDedupKey?: string;
    feedback: string;
    ruleIds: string[];
}

export interface QualityChainEvent {
    ts: string;
    label: string;
    detail: string;
}

export interface QualityDiagnosis {
    rootCause: string;
    suspectedLayer: 'fetch' | 'summarize' | 'url_heuristic' | 'llm' | 'notify' | 'unknown';
    isBug: boolean;
    expectedLog: string;
    recommendation: string;
    /** Analyze 阶段：嫌疑源码路径（相对 service 仓库根） */
    suspectedFiles?: string[];
    primaryService?: string;
    relatedServices?: string[];
    codeRef?: string;
}

/** audit-log quality_diagnosis 持久化记录 */
export interface QualityDiagnosisRecord {
    dedupKey: string;
    status: 'ok' | 'failed' | 'skipped';
    diagnosis?: QualityDiagnosis;
    agentId?: string;
    error?: string;
    codeRepo?: string;
    analyzedAt?: string;
}

function hostSuffix(url?: string): string {
    if (!url?.trim()) {
        return 'unknown-host';
    }
    try {
        const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        const parts = host.split('.');
        if (parts.length >= 2) {
            return parts.slice(-2).join('.');
        }
        return host;
    } catch {
        return 'unknown-host';
    }
}

function fieldBool(fields: QualityIncident['fields'], key: string): boolean | undefined {
    const v = fields[key];
    if (typeof v === 'boolean') {
        return v;
    }
    if (v === 'true') {
        return true;
    }
    if (v === 'false') {
        return false;
    }
    return undefined;
}

function fieldStr(fields: QualityIncident['fields'], key: string): string | undefined {
    const v = fields[key];
    return v === undefined ? undefined : String(v);
}

/** 聚类键：service|kind|because|hostSuffix */
export function buildClusterKey(
    incident: Pick<QualityIncident, 'service' | 'kind' | 'because' | 'url'>,
): string {
    return [incident.service, incident.kind, incident.because, hostSuffix(incident.url)].join('|');
}

/** 补全 clusterKey / ts 后构造事件 */
export function normalizeQualityIncident(
    partial: Omit<QualityIncident, 'clusterKey' | 'ts'> & { clusterKey?: string; ts?: string },
): QualityIncident {
    const ts = partial.ts ?? new Date().toISOString();
    const base = { ...partial, ts };
    return {
        ...base,
        clusterKey: partial.clusterKey ?? buildClusterKey(base),
    };
}

/** Hard Evaluator：单条 incident 是否应告警 */
export function evaluateQualityIncident(
    incident: QualityIncident,
    rules: QualityOpsRules = DEFAULT_QUALITY_OPS_RULES,
): QualityIncidentEval {
    const { kind, because, fields } = incident;

    if (rules.silentBecause.includes(because)) {
        return {
            pass: true,
            severity: 'silent',
            ruleId: 'quality.silent-because',
            feedback: `预期降级 because=${because}`,
        };
    }

    const fetchFailed = fieldBool(fields, 'fetchFailed');
    const urlKind = fieldStr(fields, 'urlKind');
    const chain = fieldStr(fields, 'chain') ?? '';
    const summary = fieldStr(fields, 'summary');
    const path = fieldStr(fields, 'path');

    if (
        kind === 'summary.title_only' &&
        because === SummaryDecisionBecause.nav_shell_body.code &&
        fetchFailed === false
    ) {
        return {
            pass: false,
            severity: 'hard',
            ruleId: 'quality.nav-shell-after-fetch-ok',
            feedback: '抓取已成功但摘要阶段 nav_shell_body 走 title-only，疑似误杀（USGS 类）',
        };
    }

    if (
        kind === 'summary.title_only' &&
        (chain.includes('browser:ok') || chain.includes('→browser:ok')) &&
        (summary === 'title_only' || path === 'title_only')
    ) {
        return {
            pass: false,
            severity: 'hard',
            ruleId: 'quality.fetch-ok-but-title-only',
            feedback: 'Browser 抓取成功但摘要链路为 title_only，抓取与摘要决策矛盾',
        };
    }

    if (
        kind === 'summary.title_only' &&
        because === SummaryDecisionBecause.thin_snippet.code &&
        urlKind === 'article'
    ) {
        return {
            pass: false,
            severity: 'soft',
            ruleId: 'quality.article-thin-snippet',
            feedback: '长文 URL 但仅 thin_snippet，可能需要 article_url_bypass 或 Browser 软保留',
        };
    }

    if (kind === 'summary.title_only' && because === SummaryDecisionBecause.binary_body.code) {
        return {
            pass: false,
            severity: 'soft',
            ruleId: 'quality.binary-body-title-only',
            feedback: '二进制正文走 title-only，确认是否为预期',
        };
    }

    if (kind === 'summary.title_only') {
        return {
            pass: false,
            severity: 'soft',
            ruleId: 'quality.unexpected-title-only',
            feedback: `非预期 title-only because=${because}`,
        };
    }

    if (
        (kind === 'llm.enrich' || kind === 'llm.advisor' || kind === 'llm.desk') &&
        (because === 'llm_failed' || because === 'validation_failed')
    ) {
        return {
            pass: false,
            severity: 'hard',
            ruleId: 'quality.llm-failed',
            feedback: `投资链 LLM 产物失败 kind=${kind} because=${because}`,
        };
    }

    if (kind.startsWith('fetch.') && because === ArticleFetchReason.quality_rejected.code) {
        return {
            pass: false,
            severity: 'soft',
            ruleId: 'quality.fetch-quality-rejected',
            feedback: '正文抓取 quality_rejected，关注 Browser 软保留路径',
        };
    }

    return {
        pass: true,
        severity: 'silent',
        ruleId: 'quality.no-rule-match',
        feedback: '无匹配告警规则，仅记录',
    };
}

export type QualityIncidentPartial = Omit<QualityIncident, 'clusterKey' | 'ts'> & {
    clusterKey?: string;
    ts?: string;
};

/** 是否进入质量监管（emit / KV / Capture / 日报）；pass=true 的 happy path 返回 false */
export function shouldCaptureQualityIncident(
    partial: QualityIncidentPartial,
    rules: QualityOpsRules = DEFAULT_QUALITY_OPS_RULES,
): boolean {
    return !evaluateQualityIncident(normalizeQualityIncident(partial), rules).pass;
}

/**
 * 旁路入队质量事件：无队列或 send 失败仅 warn；pass=true 不入队。
 * 上游：email-rule / invest-rss / advisor / desk。
 * 下游：Q_QUALITY_INCIDENTS → orchestrator。
 */
export async function emitQualityIncident(
    queue: { send: (body: QualityIncident) => Promise<unknown> } | undefined,
    partial: QualityIncidentPartial,
): Promise<void> {
    if (!queue) {
        return;
    }
    const incident = normalizeQualityIncident(partial);
    if (!shouldCaptureQualityIncident(incident)) {
        return;
    }
    try {
        await queue.send(incident);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
            `质量事件入队失败 kind=${partial.kind} because=${partial.because} error=${msg}`,
        );
    }
}

/** 多条 incident 聚类（仅含 pass=false 的条目） */
export function aggregateQualityClusters(
    incidents: QualityIncident[],
    rules: QualityOpsRules = DEFAULT_QUALITY_OPS_RULES,
): QualityCluster[] {
    const map = new Map<string, QualityCluster>();

    for (const incident of incidents) {
        const evalResult = evaluateQualityIncident(incident, rules);
        if (evalResult.pass) {
            continue;
        }

        const key = incident.clusterKey || buildClusterKey(incident);
        const existing = map.get(key);
        if (!existing) {
            map.set(key, {
                clusterKey: key,
                service: incident.service,
                kind: incident.kind,
                because: incident.because,
                count: 1,
                severity: evalResult.severity === 'hard' ? 'hard' : 'soft',
                sampleUrl: incident.url,
                sampleDedupKey: incident.dedupKey,
                feedback: evalResult.feedback,
                ruleIds: [evalResult.ruleId],
            });
            continue;
        }

        existing.count += 1;
        if (evalResult.severity === 'hard') {
            existing.severity = 'hard';
        }
        if (!existing.sampleUrl && incident.url) {
            existing.sampleUrl = incident.url;
        }
        if (!existing.sampleDedupKey && incident.dedupKey) {
            existing.sampleDedupKey = incident.dedupKey;
        }
        if (!existing.ruleIds.includes(evalResult.ruleId)) {
            existing.ruleIds.push(evalResult.ruleId);
        }
    }

    return [...map.values()].filter((c) => c.count >= rules.minClusterCount);
}

/** Phase 0 簇汇总告警 Markdown（非工单） */
export function formatClusterAlertMarkdown(clusters: QualityCluster[]): string {
    const lines = ['# 质量簇汇总告警', '', `共 ${clusters.length} 个簇`, ''];
    for (const c of clusters) {
        lines.push(`## ${c.clusterKey}`);
        lines.push(`- 次数：${c.count}`);
        lines.push(`- 严重度：${c.severity}`);
        lines.push(`- because：${c.because}`);
        lines.push(`- 规则：${c.ruleIds.join(', ')}`);
        if (c.sampleUrl) {
            lines.push(`- 样例 URL：${c.sampleUrl}`);
        }
        if (c.sampleDedupKey) {
            lines.push(`- 样例 dedupKey：${c.sampleDedupKey}`);
        }
        lines.push(`- 说明：${c.feedback}`);
        lines.push('');
    }
    return lines.join('\n');
}

/** 按时间排序重建链路时间线（Phase 1，基于已采集事件） */
export function reconstructQualityChain(incidents: QualityIncident[]): QualityChainEvent[] {
    const sorted = [...incidents].sort((a, b) => a.ts.localeCompare(b.ts));
    return sorted.map((inc) => {
        const parts = [
            inc.kind,
            inc.because,
            inc.fields.chain ? `chain=${inc.fields.chain}` : '',
            inc.fields.path ? `path=${inc.fields.path}` : '',
            inc.fields.summary ? `summary=${inc.fields.summary}` : '',
            inc.fields.bodyLen !== undefined ? `bodyLen=${inc.fields.bodyLen}` : '',
            inc.fields.fetchFailed !== undefined ? `fetchFailed=${inc.fields.fetchFailed}` : '',
        ].filter(Boolean);
        return {
            ts: inc.ts,
            label: inc.kind,
            detail: parts.join(' '),
        };
    });
}

export function validateQualityDiagnosis(
    d: QualityDiagnosis,
    options?: { requireSuspectedFiles?: boolean },
): { ok: boolean; reason?: string } {
    if (!d.rootCause?.trim()) {
        return { ok: false, reason: '缺少 rootCause' };
    }
    if (!d.suspectedLayer?.trim()) {
        return { ok: false, reason: '缺少 suspectedLayer' };
    }
    if (!d.expectedLog?.trim()) {
        return { ok: false, reason: '缺少 expectedLog' };
    }
    if (!d.recommendation?.trim()) {
        return { ok: false, reason: '缺少 recommendation' };
    }
    if (options?.requireSuspectedFiles) {
        if (!d.suspectedFiles?.length) {
            return { ok: false, reason: '缺少 suspectedFiles' };
        }
    }
    return { ok: true };
}

/** Phase 1 工单邮件正文 */
export function formatQualityTicketMarkdown(
    cluster: QualityCluster,
    chain: QualityChainEvent[],
    diagnosis: QualityDiagnosis,
): string {
    const lines = [
        '# 质量监管工单',
        '',
        `## 簇：${cluster.clusterKey}`,
        `- 严重度：${cluster.severity}`,
        `- 次数：${cluster.count}`,
        `- because：${cluster.because}`,
        `- 规则：${cluster.ruleIds.join(', ')}`,
        cluster.sampleUrl ? `- URL：${cluster.sampleUrl}` : '',
        cluster.sampleDedupKey ? `- dedupKey：${cluster.sampleDedupKey}` : '',
        '',
        '## 时间线',
        ...chain.map((e) => `- ${e.ts} [${e.label}] ${e.detail}`),
        '',
        '## 诊断',
        `- 根因：${diagnosis.rootCause}`,
        `- 嫌疑层：${diagnosis.suspectedLayer}`,
        `- 是否 bug：${diagnosis.isBug ? '是' : '否'}`,
        `- 期望日志：${diagnosis.expectedLog}`,
        `- 建议：${diagnosis.recommendation}`,
        '',
    ];
    return lines.filter((l) => l !== '').join('\n');
}

/** Phase 3 每日日志汇总邮件正文（Capture 索引，不含 Cursor 诊断） */
export interface QualityCaptureDigestItem {
    dedupKey: string;
    service: string;
    ts: string;
    because: string;
    logsCaptured: boolean;
    logFileCount: number;
    eventCount: number;
    url?: string;
}

export interface QualityCaptureDigestSummaryOptions {
    partIndex?: number;
    partTotal?: number;
    truncated?: boolean;
}

function csvEscapeCell(value: string): string {
    if (/[",\n\r]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

/** Phase 3 日报 capture 明细 CSV（附件） */
export function formatQualityCaptureDigestCsv(items: QualityCaptureDigestItem[]): string {
    const header = 'dedupKey,service,ts,because,logsCaptured,logFileCount,eventCount,url';
    const rows = items.map((item) =>
        [
            item.dedupKey,
            item.service,
            item.ts,
            item.because,
            item.logsCaptured ? 'true' : 'false',
            String(item.logFileCount),
            String(item.eventCount),
            item.url ?? '',
        ]
            .map((cell) => csvEscapeCell(String(cell)))
            .join(','),
    );
    return [header, ...rows].join('\n');
}

/** Phase 3 每日日志汇总邮件正文（短摘要，明细在 CSV 附件） */
export function formatQualityCaptureDigestMarkdown(
    items: QualityCaptureDigestItem[],
    window: { digestYmd: string; baselineTs: string; baselineLogId: number },
    options?: QualityCaptureDigestSummaryOptions,
): string {
    const lines = [
        '# 质量日志日报',
        '',
        `- 汇总日：${window.digestYmd}`,
        `- 增量自：${window.baselineTs}（logId > ${window.baselineLogId}）`,
        `- 新增 capture：${items.length} 条`,
    ];
    if (options?.partIndex && options?.partTotal && options.partTotal > 1) {
        lines.push(`- 分片：第 ${options.partIndex}/${options.partTotal} 封`);
    }
    if (options?.truncated) {
        lines.push('- 日志 zip 因体积上限有部分截断，详见 manifest');
    }
    if (items.length > 0) {
        lines.push(
            '',
            `- 明细附件：quality-captures-${window.digestYmd}.csv`,
            `- 平台 JSON：quality-logs-${window.digestYmd}-part*.zip`,
            '',
        );
    } else {
        lines.push('', '本窗口无新的 quality_capture 记录，无附件。', '');
    }
    return lines.join('\n');
}

/** 分片日报第 2+ 封正文 */
export function formatQualityCaptureDigestPartMarkdown(
    digestYmd: string,
    partIndex: number,
    partTotal: number,
    truncated?: boolean,
): string {
    const lines = [
        '# 质量日志日报（续）',
        '',
        `- 汇总日：${digestYmd}`,
        `- 分片：第 ${partIndex}/${partTotal} 封`,
        '',
        '本封仅含日志 zip 附件（CSV 见第 1 封）。',
    ];
    if (truncated) {
        lines.push('- 本 zip 因体积上限有部分截断，详见 manifest');
    }
    lines.push('');
    return lines.join('\n');
}

/** 日报 diagnosis 条目（正文展示，不含附件） */
export interface QualityDiagnosisDigestItem {
    dedupKey: string;
    service: string;
    ts: string;
    diagnosis: QualityDiagnosis;
    codeRepo?: string;
    fixUrl?: string;
}

export interface QualityAnalysisDigestOptions {
    partIndex?: number;
    partTotal?: number;
}

/** 08:00 日报 diagnosis 摘要区块（追加在 capture 摘要之后） */
export function formatQualityAnalysisDigestMarkdown(
    items: QualityDiagnosisDigestItem[],
    options?: QualityAnalysisDigestOptions,
): string {
    if (items.length === 0) {
        return '';
    }
    const lines = ['## 自动诊断（Cursor Analyze）', ''];
    if (options?.partIndex && options?.partTotal && options.partTotal > 1) {
        lines.push(
            `（本封 part ${options.partIndex}/${options.partTotal} 窗口内 ${items.length} 条）`,
            '',
        );
    }
    for (const item of items) {
        const d = item.diagnosis;
        lines.push(`### ${item.dedupKey}`);
        lines.push(`- service：${item.service}`);
        lines.push(`- 根因：${d.rootCause}`);
        lines.push(`- 嫌疑层：${d.suspectedLayer}`);
        lines.push(`- 是否 bug：${d.isBug ? '是' : '否'}`);
        lines.push(`- 建议：${d.recommendation}`);
        if (d.suspectedFiles?.length) {
            lines.push(`- 嫌疑文件：${d.suspectedFiles.join(', ')}`);
        }
        if (item.fixUrl && d.isBug) {
            lines.push(`- [确认修复](${item.fixUrl})`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

/** 合并 capture 正文 + diagnosis 区块 */
export function appendQualityAnalysisDigestSection(
    captureBody: string,
    diagnosisSection: string,
): string {
    if (!diagnosisSection.trim()) {
        return captureBody;
    }
    return `${captureBody.trimEnd()}\n\n${diagnosisSection.trim()}\n`;
}
