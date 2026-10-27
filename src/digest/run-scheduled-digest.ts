/**
 * Digest 编排：collect → compose → claimDedup → deliver（失败回滚 claim）。
 */

import { cadenceDateFromPeriodKey } from './cadences.js';
import { composeDigestMail } from './compose-mail.js';
import { buildDigestDedupKey } from './dedup-key.js';
import type {
    CollectedDigestSection,
    ComposedDigestMail,
    DigestDefinition,
    DigestDeliverMeta,
    ScheduledDigestRunResult,
} from './types.js';

export interface ScheduledDigestRunOptions<TEnv> {
    definition: DigestDefinition<TEnv>;
    env: TEnv;
    now?: Date;
    /**
     * 返回 true 表示本周期首次发送。
     * 契约：claim 必须可回滚——推荐「写标记」实现（D1 INSERT / KV put 一条 dedup 标记，
     * releaseDedup 时删除该标记）；勿用不可撤销语义（自增计数等），否则 deliver 失败会烧掉整周期。
     */
    claimDedup: (env: TEnv, dedupKey: string) => Promise<boolean>;
    /**
     * deliver 失败（返回 {ok:false} 或抛错）时回滚 claimDedup（可选，强烈建议提供）。
     * 推荐实现：删除 claim 写入的 dedup 标记，让本周期可被调度方重试，避免周期漏发。
     */
    releaseDedup?: (env: TEnv, dedupKey: string) => Promise<void> | void;
    /**
     * 钉扎周期（调度方补发/重试历史周期时传入）：dedupKey 与 periodKey/periodLabel 都用它；
     * 非法值抛错（HTTP 入口在 create-run-route 先行校验返回 400）。collect 仍取当前数据。
     */
    periodKeyOverride?: string;
    deliver: (
        env: TEnv,
        mail: ComposedDigestMail,
        dedupKey: string,
        meta?: DigestDeliverMeta,
    ) => Promise<{ ok: boolean; skipped?: boolean; error?: string }>;
}

/** deliver 失败后回滚 dedup；回滚自身失败仅记日志，不掩盖 deliver 原错误 */
async function releaseDedupQuietly<TEnv>(
    options: ScheduledDigestRunOptions<TEnv>,
    env: TEnv,
    dedupKey: string,
): Promise<void> {
    if (!options.releaseDedup) {
        return;
    }
    try {
        await options.releaseDedup(env, dedupKey);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`event=digest_release_dedup_failed dedupKey=${dedupKey} error=${msg}`);
    }
}

export async function runScheduledDigest<TEnv>(
    options: ScheduledDigestRunOptions<TEnv>,
): Promise<ScheduledDigestRunResult> {
    const { definition, env } = options;
    const now = options.now ?? new Date();

    let periodKey: string;
    let periodLabel: string;
    const override = options.periodKeyOverride?.trim();
    if (override) {
        const pinned = cadenceDateFromPeriodKey(definition.cadence, override);
        if (!pinned) {
            throw new Error(`invalid periodKey for cadence ${definition.cadence.id}: ${override}`);
        }
        periodKey = definition.cadence.periodKey(pinned);
        periodLabel = definition.cadence.periodLabel(pinned);
    } else {
        periodKey = definition.cadence.periodKey(now);
        periodLabel = definition.cadence.periodLabel(now);
    }

    const collected: CollectedDigestSection[] = [];
    const sorted = [...definition.sections].sort((a, b) => a.order - b.order);

    for (const section of sorted) {
        try {
            const result = await section.collect(env);
            collected.push({
                id: section.id,
                title: section.title,
                order: section.order,
                result,
            });
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            collected.push({
                id: section.id,
                title: section.title,
                order: section.order,
                result: { status: 'error', message },
            });
        }
    }

    const mail = composeDigestMail(definition, collected, periodLabel);
    if (!mail) {
        return {
            sent: false,
            skippedReason: 'all_skip',
            periodKey,
            periodLabel,
            highlightCount: 0,
            sectionSummaries: collected.map((c) => ({
                id: c.id,
                title: c.title,
                status: c.result.status,
                reason: c.result.status === 'skip' ? c.result.reason : undefined,
                message: c.result.status === 'error' ? c.result.message : undefined,
                highlightCount:
                    c.result.status === 'ok'
                        ? (c.result.highlightCount ?? c.result.lines.length)
                        : undefined,
            })),
        };
    }

    const dedupKey = buildDigestDedupKey(definition.id, periodKey);
    const claimed = await options.claimDedup(env, dedupKey);
    if (!claimed) {
        return {
            sent: false,
            skippedReason: 'dedup',
            periodKey,
            periodLabel,
            highlightCount: mail.highlightCount,
            sectionSummaries: mail.sectionSummaries,
        };
    }

    let delivered: { ok: boolean; skipped?: boolean; error?: string };
    try {
        delivered = await options.deliver(env, mail, dedupKey);
    } catch (e) {
        // deliver 抛错同样回滚 claim，让本周期可重试；返回 deliver_failed 而非向上抛
        await releaseDedupQuietly(options, env, dedupKey);
        return {
            sent: false,
            skippedReason: 'deliver_failed',
            periodKey,
            periodLabel,
            highlightCount: mail.highlightCount,
            sectionSummaries: mail.sectionSummaries,
            error: e instanceof Error ? e.message : String(e),
        };
    }
    if (!delivered.ok) {
        await releaseDedupQuietly(options, env, dedupKey);
        return {
            sent: false,
            skippedReason: 'deliver_failed',
            periodKey,
            periodLabel,
            highlightCount: mail.highlightCount,
            sectionSummaries: mail.sectionSummaries,
            error: delivered.error,
        };
    }
    if (delivered.skipped) {
        return {
            sent: false,
            skippedReason: 'deliver_skipped',
            periodKey,
            periodLabel,
            highlightCount: mail.highlightCount,
            sectionSummaries: mail.sectionSummaries,
        };
    }

    return {
        sent: true,
        periodKey,
        periodLabel,
        highlightCount: mail.highlightCount,
        sectionSummaries: mail.sectionSummaries,
    };
}
