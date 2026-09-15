/**
 * 定时多节摘要（digest）契约类型。
 * 与 notify-worker DigestItem（窗口合并入队）不同：本模块面向 sch2 等调度方触发的周期汇总。
 */

export type DigestCadenceId = 'daily' | 'weekly' | 'monthly';

export interface DigestCadence {
    id: DigestCadenceId;
    /** dedup / 周期幂等键，如 daily → 20260915，weekly → 2026-W37 */
    periodKey(date?: Date): string;
    /** 邮件总览行文案，如「周期：2026-W37」 */
    periodLabel(date?: Date): string;
}

export type DigestSectionResult =
    | { status: 'skip'; reason?: string }
    | { status: 'ok'; lines: string[]; highlightCount?: number }
    | { status: 'error'; message: string };

export interface DigestSection<TEnv = unknown> {
    id: string;
    title: string;
    order: number;
    collect(env: TEnv): Promise<DigestSectionResult>;
}

export interface DigestDefinition<TEnv = unknown> {
    id: string;
    cadence: DigestCadence;
    /** CF cron 表达式（业务声明默认值；实际触发由 sch2 job 配置） */
    cron: string;
    subjectPrefix: string;
    sections: DigestSection<TEnv>[];
}

export interface DigestCapabilityDescriptor {
    definitionId: string;
    title: string;
    cadenceOptions: DigestCadenceId[];
    defaultCron: string;
    sectionIds: string[];
    description?: string;
}

export interface ComposedDigestMail {
    subject: string;
    body: string;
    html: string;
    highlightCount: number;
    sectionSummaries: Array<{
        id: string;
        title: string;
        status: 'ok' | 'skip' | 'error';
        highlightCount?: number;
        reason?: string;
        message?: string;
    }>;
}

export interface CollectedDigestSection {
    id: string;
    title: string;
    order: number;
    result: DigestSectionResult;
}

export interface ScheduledDigestRunResult {
    sent: boolean;
    skippedReason?: 'all_skip' | 'dedup' | 'deliver_failed' | 'deliver_skipped';
    periodKey: string;
    periodLabel: string;
    highlightCount: number;
    sectionSummaries: ComposedDigestMail['sectionSummaries'];
    error?: string;
}

export interface DigestRunRequestBody {
    definitionId: string;
    periodKey?: string;
    jobId?: string;
    force?: boolean;
    alertTo?: string;
}

export interface DigestRunResponseBody {
    ok: boolean;
    sent?: boolean;
    skippedReason?: string;
    periodKey?: string;
    highlightCount?: number;
    sectionSummaries?: ComposedDigestMail['sectionSummaries'];
    error?: string;
}
